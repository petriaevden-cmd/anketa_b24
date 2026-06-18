<?php
/**
 * admin-api.php — REST-endpoint для админ-панели анкеты.
 *
 * Открывается ТОЛЬКО при валидной сессии админа (см. admin_auth_check() ниже).
 * Все запросы идут на https://<webhook>/rest/<method>.json — через cURL,
 * чтобы не зависеть от JS-SDK (админка standalone, не внутри iframe).
 *
 * Эндпоинты:
 *   GET  ?action=meta              → карта полей для рендера (группы, метки, типы)
 *   GET  ?action=search&q=...&limit= → поиск лидов (crm.lead.list)
 *   GET  ?action=get&id=12345      → один лид со всеми UF-полями (crm.lead.get)
 *   POST ?action=save&id=12345     → сохранить изменения (crm.lead.update)
 *   GET  ?action=log&id=12345      → история изменений лида
 *   POST ?action=login             → установить сессию (пароль в POST['password'])
 *   POST ?action=logout            → убить сессию
 *
 * Формат ответа — JSON: {ok: true, data: ...} или {ok: false, error: "..."}.
 * Любые ошибки пишутся в error_log (рядом с PHP-логом хоста) и в admin-changes.log
 * для action=save.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/admin-config.php';

// ─── Защита от прямого вызова без конфига ───────────────────────────────────
if (!defined('WEBHOOK_URL') || WEBHOOK_URL === '') {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => false,
        'error' => 'WEBHOOK_URL не настроен в config.php. Админка не может работать без вебхука.',
    ]);
    exit;
}

// ─── Сессии ────────────────────────────────────────────────────────────────
session_name(ADMIN_SESSION_NAME);
session_set_cookie_params([
    'lifetime' => ADMIN_SESSION_LIFETIME,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

// ─── Авторизация ───────────────────────────────────────────────────────────
function admin_auth_check(): bool {
    if (empty($_SESSION['admin_authed']) || $_SESSION['admin_authed'] !== true) {
        return false;
    }
    // Авто-выход по таймауту.
    if (!isset($_SESSION['admin_last_seen']) ||
        (time() - (int)$_SESSION['admin_last_seen']) > ADMIN_SESSION_LIFETIME) {
        admin_auth_logout();
        return false;
    }
    $_SESSION['admin_last_seen'] = time();
    return true;
}

function admin_auth_login(string $password): bool {
    if (hash_equals((string)ADMIN_PASSWORD, $password)) {
        session_regenerate_id(true);
        $_SESSION['admin_authed']  = true;
        $_SESSION['admin_user']    = ADMIN_USERNAME;
        $_SESSION['admin_last_seen'] = time();
        return true;
    }
    return false;
}

function admin_auth_logout(): void {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params['path'], $params['domain'], $params['secure'], $params['httponly']);
    }
    session_destroy();
}

// ─── Curl-обёртка для Bitrix24 REST ────────────────────────────────────────
/**
 * bx24_call($method, $params = []) — вызов REST-метода Битрикс24 через webhook.
 *
 * Возвращает массив:
 *   ['ok' => true,  'data' => <ответ из result>]
 *   ['ok' => false, 'error' => <текст ошибки>, 'http' => <код>]
 *
 * Никаких throw — все ошибки в error_log + возвращаемое значение.
 */
function bx24_call(string $method, array $params = []): array {
    $url = rtrim((string)WEBHOOK_URL, '/') . '/' . $method . '.json';

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => json_encode($params, JSON_UNESCAPED_UNICODE),
    ]);

    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        error_log('[admin-api] curl error: ' . $err . ' method=' . $method);
        return ['ok' => false, 'error' => 'Сеть Битрикс24 недоступна: ' . $err];
    }

    $resp = json_decode($body, true);
    if (!is_array($resp)) {
        error_log('[admin-api] bad json from B24: ' . substr($body, 0, 500));
        return ['ok' => false, 'error' => 'Битрикс24 вернул не-JSON ответ'];
    }

    if (!empty($resp['error'])) {
        $errTxt = is_array($resp['error'])
            ? ($resp['error']['error_description'] ?? $resp['error']['error'] ?? json_encode($resp['error']))
            : (string)$resp['error'];
        error_log('[admin-api] B24 error: ' . $errTxt . ' method=' . $method);
        return ['ok' => false, 'error' => 'Битрикс24: ' . $errTxt];
    }

    if ($code >= 400) {
        return ['ok' => false, 'error' => 'Битрикс24 вернул HTTP ' . $code, 'http' => $code];
    }

    return ['ok' => true, 'data' => $resp['result'] ?? null];
}

// ─── Логирование изменений ────────────────────────────────────────────────
/**
 * log_admin_change($leadId, $changes, $user) — пишет одну запись о правке в admin-changes.log.
 *
 * $changes — массив ['FIELD_CODE' => ['old' => ..., 'new' => ...], ...]
 *
 * Формат строки лога (JSON-Lines — каждая строка валидный JSON, легко парсить):
 *   {"ts":"2026-06-18T12:30:45+04:00","user":"admin","lead":12345,
 *    "field":"UF_CRM_1764765025374","old":"Иван","new":"Иван Иванович"}
 */
function log_admin_change(int $leadId, array $changes, string $user): void {
    $path = ADMIN_LOG_FILE;
    $dir  = dirname($path);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);

    $fp = @fopen($path, 'ab');
    if (!$fp) {
        error_log('[admin-api] не удалось открыть лог-файл: ' . $path);
        return;
    }

    $ts = (new DateTimeImmutable('now'))->format(DateTimeInterface::ATOM);
    foreach ($changes as $field => $diff) {
        $old = is_array($diff) ? ($diff['old'] ?? null) : null;
        $new = is_array($diff) ? ($diff['new'] ?? null) : null;
        // Нормализуем пустые строки к null, чтобы лог не пух.
        if ($old === '') $old = null;
        if ($new === '') $new = null;
        if ($old === $new) continue;

        $entry = [
            'ts'    => $ts,
            'user'  => $user,
            'lead'  => $leadId,
            'field' => $field,
            'old'   => $old,
            'new'   => $new,
        ];
        fwrite($fp, json_encode($entry, JSON_UNESCAPED_UNICODE) . "\n");
    }
    fclose($fp);
}

/**
 * read_admin_log($leadId, $limit) — читает последние N записей для лида.
 * Возвращает массив записей (новые сверху).
 */
function read_admin_log(int $leadId, int $limit = 50): array {
    $path = ADMIN_LOG_FILE;
    if (!is_file($path) || !is_readable($path)) return [];

    // Файл может расти, читаем построчно. Оптимизация: tail через fseek.
    $size = filesize($path);
    if ($size === false || $size === 0) return [];

    $chunkSize = max($size, 64 * 1024);
    $entries   = [];
    $fp = fopen($path, 'rb');
    if (!$fp) return [];

    // Идём с конца, читаем блоками.
    $pos = $size;
    $buf = '';
    while ($pos > 0 && count($entries) < $limit * 4) {
        $readSize = min($chunkSize, $pos);
        $pos -= $readSize;
        fseek($fp, $pos);
        $buf = fread($fp, $readSize) . $buf;
        $lines = explode("\n", $buf);
        // Неполную первую строку оставляем в буфере до следующей итерации.
        if ($pos > 0) {
            $buf = array_shift($lines);
        } else {
            $buf = '';
        }
        // Идём с конца — новые записи сверху.
        for ($i = count($lines) - 1; $i >= 0; $i--) {
            $line = trim($lines[$i]);
            if ($line === '') continue;
            $obj = json_decode($line, true);
            if (!is_array($obj) || !isset($obj['lead'])) continue;
            if ((int)$obj['lead'] !== $leadId) continue;
            $entries[] = $obj;
            if (count($entries) >= $limit) break 2;
        }
    }
    fclose($fp);

    // Уже отсортированы новые сверху (шли с конца).
    return $entries;
}

// ─── Роутер ────────────────────────────────────────────────────────────────
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

$action = isset($_GET['action']) ? (string)$_GET['action']
         : (isset($_POST['action']) ? (string)$_POST['action'] : '');

// Все экшены кроме login требуют авторизации.
$publicActions = ['login'];
$isPublic = in_array($action, $publicActions, true);

if (!$isPublic && !admin_auth_check()) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Требуется авторизация', 'auth' => false]);
    exit;
}

try {
    switch ($action) {

        // ── login / logout ────────────────────────────────────────────────
        case 'login': {
            $pw = isset($_POST['password']) ? (string)$_POST['password'] : '';
            if (admin_auth_login($pw)) {
                echo json_encode(['ok' => true, 'user' => ADMIN_USERNAME]);
            } else {
                http_response_code(403);
                echo json_encode(['ok' => false, 'error' => 'Неверный пароль']);
            }
            break;
        }
        case 'logout': {
            admin_auth_logout();
            echo json_encode(['ok' => true]);
            break;
        }

        // ── meta — карта полей для рендера в UI ───────────────────────────
        case 'meta': {
            global $ADMIN_FIELD_MAP, $ADMIN_FIELD_HIDDEN;
            echo json_encode([
                'ok'     => true,
                'fields' => $ADMIN_FIELD_MAP,
                'hidden' => $ADMIN_FIELD_HIDDEN,
                'user'   => $_SESSION['admin_user'] ?? '',
            ]);
            break;
        }

        // ── search — поиск лидов ──────────────────────────────────────────
        case 'search': {
            $q     = trim((string)($_GET['q'] ?? ''));
            $limit = max(1, min(50, (int)($_GET['limit'] ?? 15)));

            // Пустой запрос — отдаём последние изменённые лиды.
            if ($q === '') {
                $r = bx24_call('crm.lead.list', [
                    'order'  => ['DATE_MODIFY' => 'DESC'],
                    'select' => ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME', 'STATUS_ID',
                                 'PHONE', 'EMAIL', 'DATE_MODIFY', 'ASSIGNED_BY_ID'],
                    'filter' => ['>ID' => '0'],
                    'start'  => 0,
                ]);
                if (!$r['ok']) { echo json_encode($r); break; }
                $items = array_slice((array)$r['data'], 0, $limit);
                echo json_encode(['ok' => true, 'items' => $items, 'mode' => 'recent']);
                break;
            }

            // Поиск по фрагменту — 3 параллельных запроса по подстрокам.
            $select = ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME', 'STATUS_ID',
                       'PHONE', 'EMAIL', 'DATE_MODIFY', 'ASSIGNED_BY_ID'];
            $found  = [];
            $seen   = [];

            // 1. По ID (если число)
            if (ctype_digit($q)) {
                $r = bx24_call('crm.lead.get', ['ID' => (int)$q]);
                if ($r['ok'] && $r['data']) {
                    $found[] = $r['data'];
                    $seen[(int)$r['data']['ID']] = true;
                }
            }

            // 2. По имени
            $r = bx24_call('crm.lead.list', [
                'order'  => ['DATE_MODIFY' => 'DESC'],
                'select' => $select,
                'filter' => ['%NAME' => $q],
                'start'  => 0,
            ]);
            if ($r['ok']) foreach ((array)$r['data'] as $lead) {
                if (!isset($seen[(int)$lead['ID']])) {
                    $found[] = $lead; $seen[(int)$lead['ID']] = true;
                }
            }

            // 3. По фамилии
            $r = bx24_call('crm.lead.list', [
                'order'  => ['DATE_MODIFY' => 'DESC'],
                'select' => $select,
                'filter' => ['%LAST_NAME' => $q],
                'start'  => 0,
            ]);
            if ($r['ok']) foreach ((array)$r['data'] as $lead) {
                if (!isset($seen[(int)$lead['ID']])) {
                    $found[] = $lead; $seen[(int)$lead['ID']] = true;
                }
            }

            // 4. По телефону/email (если похоже)
            if (preg_match('/[\d@]/', $q)) {
                $r = bx24_call('crm.lead.list', [
                    'order'  => ['DATE_MODIFY' => 'DESC'],
                    'select' => $select,
                    'filter' => ['%PHONE' => $q],
                    'start'  => 0,
                ]);
                if ($r['ok']) foreach ((array)$r['data'] as $lead) {
                    if (!isset($seen[(int)$lead['ID']])) {
                        $found[] = $lead; $seen[(int)$lead['ID']] = true;
                    }
                }
                $r = bx24_call('crm.lead.list', [
                    'order'  => ['DATE_MODIFY' => 'DESC'],
                    'select' => $select,
                    'filter' => ['%EMAIL' => $q],
                    'start'  => 0,
                ]);
                if ($r['ok']) foreach ((array)$r['data'] as $lead) {
                    if (!isset($seen[(int)$lead['ID']])) {
                        $found[] = $lead; $seen[(int)$lead['ID']] = true;
                    }
                }
            }

            // Сортируем по дате изменения (новые сверху) и режем лимит.
            usort($found, function ($a, $b) {
                return strcmp((string)($b['DATE_MODIFY'] ?? ''), (string)($a['DATE_MODIFY'] ?? ''));
            });
            $items = array_slice($found, 0, $limit);

            echo json_encode(['ok' => true, 'items' => $items, 'mode' => 'search', 'total' => count($found)]);
            break;
        }

        // ── get — один лид ────────────────────────────────────────────────
        case 'get': {
            $id = (int)($_GET['id'] ?? 0);
            if ($id <= 0) { echo json_encode(['ok' => false, 'error' => 'ID лида не указан']); break; }

            $r = bx24_call('crm.lead.get', ['ID' => $id]);
            if (!$r['ok']) { echo json_encode($r); break; }

            // Дополнительно подтянем историю лога для этого лида.
            $log = read_admin_log($id, ADMIN_MAX_LOG_ROWS);

            echo json_encode(['ok' => true, 'lead' => $r['data'], 'log' => $log]);
            break;
        }

        // ── save — сохранить изменения ────────────────────────────────────
        case 'save': {
            $id = (int)($_POST['id'] ?? $_GET['id'] ?? 0);
            if ($id <= 0) { echo json_encode(['ok' => false, 'error' => 'ID лида не указан']); break; }

            $raw = file_get_contents('php://input');
            $body = json_decode($raw, true);
            if (!is_array($body) || !isset($body['fields']) || !is_array($body['fields'])) {
                echo json_encode(['ok' => false, 'error' => 'Нет данных для сохранения']);
                break;
            }

            // 1. Получаем текущее состояние лида, чтобы посчитать diff.
            $cur = bx24_call('crm.lead.get', ['ID' => $id]);
            if (!$cur['ok']) { echo json_encode($cur); break; }
            $current = (array)$cur['data'];

            // 2. Нормализуем входные значения по типу поля (из карты).
            global $ADMIN_FIELD_MAP;
            $edits   = [];
            $changes = []; // для лога

            foreach ($body['fields'] as $code => $value) {
                if (!isset($ADMIN_FIELD_MAP[$code])) {
                    // Неизвестное поле — игнорируем (защита от подмены).
                    continue;
                }
                $meta = $ADMIN_FIELD_MAP[$code];
                $old  = $current[$code] ?? null;

                $new = normalize_field_value($meta, $value);

                // Сравниваем по нормализованному значению (например, money → '123|RUB').
                $oldN = normalize_field_value($meta, $old);
                if ((string)$oldN === (string)$new) continue;

                $edits[$code]       = $new;
                $changes[$code]     = ['old' => $old, 'new' => $new];
            }

            if (empty($edits)) {
                echo json_encode(['ok' => true, 'changed' => 0, 'log' => read_admin_log($id, ADMIN_MAX_LOG_ROWS)]);
                break;
            }

            // 3. Применяем.
            $r = bx24_call('crm.lead.update', ['ID' => $id, 'fields' => $edits]);
            if (!$r['ok']) { echo json_encode($r); break; }

            // 4. Логируем.
            log_admin_change($id, $changes, (string)($_SESSION['admin_user'] ?? 'unknown'));

            // 5. Возвращаем обновлённый лид + свежий лог.
            $newLead = bx24_call('crm.lead.get', ['ID' => $id]);
            $log     = read_admin_log($id, ADMIN_MAX_LOG_ROWS);

            echo json_encode([
                'ok'      => true,
                'changed' => count($edits),
                'fields'  => array_keys($edits),
                'lead'    => $newLead['data'] ?? null,
                'log'     => $log,
            ]);
            break;
        }

        // ── log — история изменений лида ───────────────────────────────────
        case 'log': {
            $id = (int)($_GET['id'] ?? 0);
            $limit = max(1, min(200, (int)($_GET['limit'] ?? ADMIN_MAX_LOG_ROWS)));
            if ($id <= 0) { echo json_encode(['ok' => false, 'error' => 'ID лида не указан']); break; }
            echo json_encode(['ok' => true, 'log' => read_admin_log($id, $limit)]);
            break;
        }

        default:
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Неизвестный action: ' . $action]);
    }
} catch (Throwable $e) {
    error_log('[admin-api] exception: ' . $e->getMessage() . "\n" . $e->getTraceAsString());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Внутренняя ошибка: ' . $e->getMessage()]);
}

// ─── Нормализация значений по типу поля ───────────────────────────────────
function normalize_field_value(array $meta, $value) {
    if ($value === null || $value === '') return '';

    switch ($meta['type']) {
        case 'money': {
            // На входе — сумма в ₽ (число или строка с пробелами). На выходе — '12345|RUB'.
            $digits = preg_replace('/\D+/', '', (string)$value);
            return $digits === '' ? '' : ($digits . '|RUB');
        }
        case 'boolean': {
            // 'Y'/'N'/true/false/1/0 → '1' или '0' (как хранит Битрикс UF_DEPOSIT и т.п.)
            if ($value === 'Y' || $value === '1' || $value === 1 || $value === true || $value === 'true') {
                return '1';
            }
            return '0';
        }
        case 'enum':
        case 'string':
        case 'datetime':
        default:
            return (string)$value;
    }
}
