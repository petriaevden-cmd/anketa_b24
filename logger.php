<?php
/**
 * logger.php — серверный приёмник событий лог-файла.
 *
 * Принимает POST-запросы от logger-client.js и дописывает строки в logs.txt.
 * Файл лога хранится рядом с logger.php (в корне папки anketa).
 *
 * Формат одной строки в logs.txt:
 *   [2026-06-04 10:15:22 +04] | leadId=59466 | user=Иванов Алексей | event=FORM_SAVED | data={"fields":5}
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

// ─── Читаем тело запроса ────────────────────────────────────────────────────
$raw = file_get_contents('php://input');
$payload = json_decode($raw, true);

if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON']);
    exit;
}

// ─── Извлекаем поля ─────────────────────────────────────────────────────────
$event   = isset($payload['event'])   ? trim((string)$payload['event'])   : 'UNKNOWN';
$leadId  = isset($payload['leadId'])  ? (int)$payload['leadId']           : 0;
$user    = isset($payload['user'])    ? trim((string)$payload['user'])     : '—';
$data    = isset($payload['data'])    ? $payload['data']                   : null;
$env     = isset($payload['env'])     ? trim((string)$payload['env'])      : '?';

// ─── Формируем строку лога ───────────────────────────────────────────────────
// Временная метка с учётом часового пояса сервера (+04 Самара)
date_default_timezone_set('Europe/Samara');
$timestamp = date('Y-m-d H:i:s P');

$dataStr = '';
if ($data !== null) {
    $dataStr = ' | data=' . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
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

// ─── Пишем в logs.txt ────────────────────────────────────────────────────────
$logFile = __DIR__ . '/logs.txt';

// FILE_APPEND — дописываем, не затираем; LOCK_EX — блокировка от одновременной записи
$result = file_put_contents($logFile, $line, FILE_APPEND | LOCK_EX);

if ($result === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Cannot write to log file']);
    exit;
}

echo json_encode(['ok' => true]);
