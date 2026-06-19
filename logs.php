<?php
/**
 * logs.php — просмотрщик лог-файла с явным UTF-8.
 *
 * Открывается в браузере: https://apcheit.ru/yurclick/anketa-kc/logs.php
 * Вместо logs.txt (который браузер отдаёт как Latin-1) этот скрипт
 * явно указывает charset=utf-8, и кириллица читается корректно.
 *
 * Параметры URL:
 *   ?tail=200   — показать последние N строк (по умолчанию 200)
 *   ?dl=1       — скачать файл целиком как UTF-8 text/plain
 */

mb_internal_encoding('UTF-8');
ini_set('default_charset', 'UTF-8');

$logFile = __DIR__ . '/logs.txt';

// ── Скачать файл ─────────────────────────────────────────────────────────────
if (!empty($_GET['dl'])) {
    if (!is_readable($logFile)) {
        http_response_code(404);
        exit('logs.txt not found');
    }
    header('Content-Type: text/plain; charset=utf-8');
    header('Content-Disposition: attachment; filename="logs.txt"');
    readfile($logFile);
    exit;
}

// ── Показать в браузере ───────────────────────────────────────────────────────
$tail = isset($_GET['tail']) ? max(1, (int)$_GET['tail']) : 200;

$lines = [];
if (is_readable($logFile)) {
    $all   = file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    $lines = array_slice($all, -$tail);
}

$count = count($lines);
$total = is_readable($logFile) ? count(file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES)) : 0;
?>
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Логи анкеты</title>
<style>
  body { font-family: 'Courier New', monospace; font-size: 13px; background:#1e1e1e; color:#d4d4d4; margin:0; padding:16px; }
  h1   { font-family: sans-serif; font-size: 16px; color:#9cdcfe; margin:0 0 8px; }
  .meta { font-family: sans-serif; font-size: 12px; color:#6a9955; margin-bottom: 12px; }
  .meta a { color:#569cd6; }
  pre  { margin:0; white-space: pre-wrap; word-break: break-all; }
  .line { padding: 2px 0; border-bottom: 1px solid #2d2d2d; }
  .line:hover { background: #2a2d2e; }
  /* подсветка по env */
  .env-prod { color:#f44747; }
  .env-dev  { color:#dcdcaa; }
</style>
</head>
<body>
<h1>Логи анкеты — logs.txt</h1>
<div class="meta">
  Показано последних <?= $count ?> из <?= $total ?> строк.
  &nbsp;|&nbsp; <a href="?tail=<?= $tail * 2 ?>">Показать ещё (×2)</a>
  &nbsp;|&nbsp; <a href="?tail=9999">Все строки</a>
  &nbsp;|&nbsp; <a href="?dl=1">Скачать файл</a>
</div>
<pre>
<?php foreach ($lines as $line): ?>
<div class="line <?= strpos($line, 'env=prod') !== false ? 'env-prod' : (strpos($line, 'env=dev') !== false ? 'env-dev' : '') ?>"><?= htmlspecialchars($line, ENT_QUOTES | ENT_HTML5, 'UTF-8') ?></div>
<?php endforeach; ?>
</pre>
</body>
</html>
