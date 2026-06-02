<?php
/**
 * uninstall.php — деинсталлятор локального приложения «Анкета (МКЦ + МП)»
 *
 * Вызывается Битрикс24 при удалении приложения администратором.
 *
 * Что делает:
 *   1. BX24.init() — инициализация SDK.
 *   2. placement.unbind — отвязывает вкладку «Анкета» из карточки лида
 *      (PLACEMENT = CRM_LEAD_DETAIL_TAB, HANDLER = URL текущего обработчика).
 *   3. BX24.installFinish() — сигнал Битрикс24 о завершении удаления.
 *
 * Что НЕ делает (и почему):
 *   — Не удаляет пользовательские UF-поля лида. Поля заводятся вручную
 *     администратором CRM до установки приложения (install.php в v3 не
 *     используется и не запускается). Поэтому уничтожать UF-поля при
 *     удалении приложения некорректно: можно потерять данные анкет во всех
 *     лидах и при этом задеть поля, которые могут использоваться другими
 *     приложениями/сценариями. Если нужно удалить поля — это делается
 *     вручную из интерфейса CRM.
 */

// Подключаем конфигурационный файл config.php из того же каталога (__DIR__).
require_once __DIR__ . '/config.php';

// Извлекаем только хост из PORTAL_URL и экранируем для безопасной вставки в HTML.
$portalHost = htmlspecialchars(parse_url(PORTAL_URL, PHP_URL_HOST), ENT_QUOTES);

// URL обработчика виджета — адрес index.php, который использовался при установке.
$handlerUrl = rtrim(PORTAL_URL, '/') . '/anketa-kc/index.php';
?>
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Удаление — Анкета (МКЦ + МП)</title>

  <!-- BX24 JS SDK: грузится с портала клиента (требование платформы). -->
  <script src="https://<?= $portalHost ?>/bitrix/js/rest/bx24.js"></script>

  <!-- Tailwind CSS v4 CDN — единый стек с install.php и index.php. -->
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>

  <style>
    html, body { margin: 0; padding: 0; }
  </style>
</head>

<body class="bg-gray-50 text-gray-800 text-sm antialiased">

<div class="max-w-xl mx-auto px-6 py-8">

  <h1 class="text-lg font-bold text-gray-900 mb-1">Удаление приложения «Анкета»</h1>
  <p class="text-xs text-gray-500 mb-6">
    Отвязка вкладки «Анкета» из карточки лида. Пользовательские поля лида
    (UF_CRM_*) не затрагиваются — их при необходимости удаляют вручную
    из настроек CRM.
  </p>

  <!-- ── Экран подтверждения ──────────────────────────────────────────────── -->
  <div id="confirm-block" class="space-y-4">

    <div class="p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
      После удаления вкладка «Анкета» исчезнет из карточки лида.
      Данные анкет в лидах сохраняются.
    </div>

    <div class="flex gap-3">
      <button id="btn-uninstall"
        class="flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors cursor-pointer">
        Удалить приложение
      </button>
    </div>
  </div>

  <!-- ── Блок прогресса ───────────────────────────────────────────────────── -->
  <div id="progress-block" class="hidden">
    <div class="mb-4">
      <div class="flex items-center justify-between mb-1">
        <span id="step-label" class="text-xs font-medium text-gray-600">Подготовка...</span>
        <span id="step-counter" class="text-xs text-gray-400"></span>
      </div>
      <div class="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <div id="progress-bar" class="h-full bg-blue-500 rounded-full transition-all duration-300" style="width:0%"></div>
      </div>
    </div>

    <div id="log" class="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-600 space-y-1 max-h-72 overflow-y-auto font-mono"></div>
  </div>

  <div id="error-block" class="hidden mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"></div>
  <div id="success-block" class="hidden mt-4 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800"></div>

</div>

<script>
'use strict';

// HANDLER_URL передаётся из PHP через json_encode (без \uXXXX и \/).
var HANDLER_URL = <?= json_encode($handlerUrl, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>;

// ─── UI-хелперы ──────────────────────────────────────────────────────────────

function log(msg) {
  var el = document.getElementById('log');
  if (!el) return;
  var line = document.createElement('div');
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function setStep(label, current, total) {
  var stepLabel   = document.getElementById('step-label');
  var stepCounter = document.getElementById('step-counter');
  var bar         = document.getElementById('progress-bar');

  if (stepLabel)   stepLabel.textContent   = label;
  if (stepCounter) stepCounter.textContent = total ? (current + ' / ' + total) : '';
  if (bar && total) bar.style.width = Math.round((current / total) * 100) + '%';
}

function showError(msg) {
  var el = document.getElementById('error-block');
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  log('ОШИБКА: ' + msg);
}

function showSuccess(msg) {
  var el = document.getElementById('success-block');
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  log(msg);
}

function showProgress() {
  document.getElementById('confirm-block').classList.add('hidden');
  document.getElementById('progress-block').classList.remove('hidden');
}

// ─── Инициализация SDK и привязка кнопки ─────────────────────────────────────

BX24.init(function () {
  log('BX24.init — SDK готов');

  document.getElementById('btn-uninstall').addEventListener('click', function () {
    showProgress();
    log('Запуск удаления приложения');
    startUninstall();
  });
});

// ─── Шаг 1: отвязать placement ───────────────────────────────────────────────

function startUninstall() {
  setStep('Отвязка вкладки из карточки лида...', 0, 0);

  BX24.callMethod(
    'placement.unbind',
    {
      PLACEMENT: 'CRM_LEAD_DETAIL_TAB',
      HANDLER:   HANDLER_URL
    },
    function (unbindRes) {
      if (unbindRes.error()) {
        var errMsg = String(unbindRes.error());
        if (errMsg.indexOf('NOT_FOUND') !== -1) {
          log('  ⚠ Вкладка уже была отвязана (пропуск)');
        } else {
          showError('Ошибка placement.unbind: ' + unbindRes.error());
          return;
        }
      } else {
        var count = unbindRes.data() && unbindRes.data().count ? unbindRes.data().count : 0;
        log('  ✓ Вкладка «Анкета» отвязана (удалено обработчиков: ' + count + ')');
      }

      finishUninstall();
    }
  );
}

// ─── Шаг 2: завершение ───────────────────────────────────────────────────────

function finishUninstall() {
  setStep('Готово', 1, 1);
  showSuccess('Удаление завершено. Вкладка отвязана, пользовательские поля лида сохранены.');
  log('BX24.installFinish() — сигнализируем Битрикс24 о завершении удаления');
  BX24.installFinish();
}
</script>

</body>
</html>
