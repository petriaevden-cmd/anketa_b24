<?php
// Явно задаём UTF-8 для всех mb_* функций и json_encode.
mb_internal_encoding('UTF-8');
ini_set('default_charset', 'UTF-8');

/**
 * logger.php — серверный приёмник событий лог-файла.
 *
 * Принимает POST-запросы от logger-client.js и дописывает строки в logs.txt.
 * Файл лога хранится рядом с logger.php (в корне папки anketa).
 *
 * Формат одной строки в logs.txt:
 *   [2026-06-04 10:15:22 +04:00] | env=prod | leadId=59466 | user=Иванов Алексей | event=FORM_SAVED | data={"fio":"…","city":"…"}
 *
 * Принципы записи:
 *   • data проходит рекурсивную санитизацию:
 *       — строки декодируются из HTML-сущностей (один проход, ENT_QUOTES),
 *         чтобы в логе не светились артефакты типа &amp;amp;amp;amp;amp;nbsp;
 *       — управляющие символы (\r, \n, \0) и табы заменяются на пробел,
 *         чтобы строка лога всегда была ровно одной строкой;
 *       — значения «опасных» полей (user) экранируют вертикальную черту,
 *         чтобы не ломать pipe-разделитель формата;
 *       — слишком длинные строки обрезаются, общий объём data — не более 4 КБ.
 *   • Запись ведётся с LOCK_EX — без гонок при параллельных запросах.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Браузер сначала шлёт OPTIONS (preflight) — отвечаем пустым 200
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

// ─── Лимиты ─────────────────────────────────────────────────────────────────
const MAX_STRING_LEN   = 500;   // макс. длина одного строкового значения в data
const MAX_USER_LEN     = 200;   // макс. длина поля user
const MAX_EVENT_LEN    = 64;    // макс. длина имени события
const MAX_ENV_LEN      = 16;    // макс. длина имени окружения
const MAX_DATA_BYTES   = 4096;  // макс. размер сериализованного data
const TRUNC_MARKER     = '…[trunc]';

// ─── Санитайзер строк ───────────────────────────────────────────────────────

/**
 * Нормализует одну строку перед записью в лог:
 *   • декодирует HTML-сущности один раз (на случай, если Bitrix24 возвращает
 *     многократно закодированные названия лидов: &amp;amp;…nbsp;);
 *   • убирает \0, схлопывает \r / \n / \t в пробел — чтобы строка лога
 *     всегда была одной строкой и не ломала grep / tail;
 *   • обрезает до MAX_STRING_LEN.
 *
 * @param mixed $value
 * @param int   $maxLen
 * @return mixed
 */
function sanitize_string($value, $maxLen)
{
    if (!is_string($value)) {
        return $value;
    }

    // 1. Декодируем HTML-сущности. Идём циклом, пока строка меняется — Bitrix24
    //    иногда возвращает названия лидов, закодированные по 5 раз подряд
    //    (&amp;amp;amp;amp;amp;nbsp;), и одного прохода недостаточно. Ограничиваем
    //    сверху 10 итерациями, чтобы исключить бесконечный цикл на патологическом
    //    вводе. Если вход уже «чистый», html_entity_decode возвращает строку
    //    как есть — первый же identical()-чек выйдет из цикла.
    $decoded = $value;
    for ($i = 0; $i < 10; $i++) {
        $next = html_entity_decode($decoded, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        if ($next === $decoded) {
            break;
        }
        $decoded = $next;
    }

    // 2. Убираем управляющие символы, которые ломают построчный формат лога.
    $cleaned = str_replace(["\0", "\r", "\n", "\t"], ' ', $decoded);

    // 3. Схлопываем повторяющиеся пробелы (например, после \n\n).
    $cleaned = preg_replace('/ {2,}/u', ' ', $cleaned);

    // 4. Обрезаем, если слишком длинная строка.
    if (mb_strlen($cleaned, 'UTF-8') > $maxLen) {
        $cleaned = mb_substr($cleaned, 0, $maxLen - mb_strlen(TRUNC_MARKER, 'UTF-8'), 'UTF-8') . TRUNC_MARKER;
    }

    return $cleaned;
}

/**
 * Рекурсивно проходит по структуре и санитизирует все строковые значения.
 *
 * @param mixed $data
 * @return mixed
 */
function sanitize_data($data)
{
    if (is_array($data)) {
        $out = [];
        foreach ($data as $k => $v) {
            $out[$k] = sanitize_data($v);
        }
        return $out;
    }
    if (is_string($data)) {
        return sanitize_string($data, MAX_STRING_LEN);
    }
    // числа, bool, null — оставляем как есть.
    return $data;
}

/**
 * Защита для pipe-разделителя: '|' внутри значения делает формат лога
 * неоднозначным при разборе, заменяем на безопасный аналог.
 */
function escape_pipe($value)
{
    if (!is_string($value)) {
        return $value;
    }
    return str_replace('|', '/', $value);
}

// ─── Читаем тело запроса ────────────────────────────────────────────────────
$raw = file_get_contents('php://input');
$payload = json_decode($raw, true);

if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON']);
    exit;
}

// ─── Извлекаем и нормализуем поля ───────────────────────────────────────────
$event   = escape_pipe(sanitize_string(isset($payload['event'])  ? $payload['event']  : 'UNKNOWN', MAX_EVENT_LEN));
$leadId  = isset($payload['leadId']) ? (int)$payload['leadId'] : 0;
$user    = escape_pipe(sanitize_string(isset($payload['user'])   ? $payload['user']   : '—',        MAX_USER_LEN));
$env     = escape_pipe(sanitize_string(isset($payload['env'])    ? $payload['env']    : '?',         MAX_ENV_LEN));
$data    = isset($payload['data'])   ? sanitize_data($payload['data']) : null;

// ─── Формируем строку лога ──────────────────────────────────────────────────
// Временная метка с учётом часового пояса сервера (+04 Самара).
date_default_timezone_set('Europe/Samara');
$timestamp = date('Y-m-d H:i:s P');

$dataStr = '';
if ($data !== null) {
    // Сначала сериализуем, потом — если суммарно длиннее лимита — обрезаем строку
    // (а не массив: проще гарантировать, что лог-файл не разрастётся из-за жирных data).
    $dataStr = ' | data=' . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (strlen($dataStr) > MAX_DATA_BYTES) {
        $dataStr = substr($dataStr, 0, MAX_DATA_BYTES - mb_strlen(TRUNC_MARKER, 'UTF-8')) . TRUNC_MARKER;
    }
}

$line = sprintf(
    "[%s] | env=%s | leadId=%d | user=%s | event=%s%s\n",
    $timestamp,
    $env,
    $leadId,
    $user,
    $event,
    $dataStr
);

// ─── Пишем в logs.txt ───────────────────────────────────────────────────────
$logFile = __DIR__ . '/logs.txt';

// FILE_APPEND — дописываем, не затираем; LOCK_EX — блокировка от одновременной записи
$result = file_put_contents($logFile, $line, FILE_APPEND | LOCK_EX);

if ($result === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Cannot write to log file']);
    exit;
}

echo json_encode(['ok' => true]);