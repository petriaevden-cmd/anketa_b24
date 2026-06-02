<?php
/**
 * index.php — основной iframe-виджет анкеты (МКЦ + МП)
 * Загружается Bitrix24 во вкладке карточки лида (CRM_LEAD_DETAIL_TAB)
 *
 * Frontend: Tailwind CSS 4 + Flowbite 2
 * Самописные CSS-файлы НЕ подключаются.
 *
 * Порядок блоков (синхронизирован с form.js):
 *   1. Персональные данные  (#personal-body)  — включает поле «Город» → TZ
 *   2. Финансовые данные   (#finance-body)
 *   3. Кредитная история   (#credit-body)
 *   4. Заметки менеджера  (#manager-body)
 *   5. Запись на встречу  (#booking-body)
 */

require_once __DIR__ . '/config.php';

$portalHost  = htmlspecialchars(parse_url(PORTAL_URL, PHP_URL_HOST), ENT_QUOTES);
$salesDeptId  = (int) SALES_DEPT_ID;
$bpTemplateId = (int) BP_TEMPLATE_ID;
$slotMin     = (int) SLOT_DURATION_MIN;
$horizonDays = (int) SLOT_HORIZON_DAYS;
$minSlots    = (int) MIN_SLOTS_PER_DAY;
$clientHrMin = (int) CLIENT_HOUR_MIN;
$clientHrMax = (int) CLIENT_HOUR_MAX;
$minMpPerDay = (int) MIN_MP_PER_DAY;

// Данные текущего пользователя, открывшего приложение.
// Битрикс24 прокидывает их в $_REQUEST при загрузке iframe-плейсмента.
// Используются как currentUser в APP_CONFIG → webhook-client.js (dev-режим).
// В продуктиве (iframe) реальный пользователь приходит через BX24.callMethod('user.current').
$currentUser = [
    'ID'        => (int)   ($_REQUEST['member_id']   ?? $_REQUEST['USER_ID']   ?? 0),
    'NAME'      => (string)($_REQUEST['USER_NAME']   ?? ''),
    'LAST_NAME' => (string)($_REQUEST['USER_LAST_NAME'] ?? ''),
    'EMAIL'     => (string)($_REQUEST['USER_EMAIL']  ?? ''),
];

?>
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Анкета</title>

  <!--
    BX24 JS SDK для handler на внешнем домене (apcheit.ru) нужно подключать явно —
    портал не инжектит bx24.js в наш HTML. Как в install.php: CDN api.bitrix24.com.
    В dev-режиме (вне iframe) webhook-client.js подменит window.BX24 shim'ом.
  -->

  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/flowbite/2.3.0/flowbite.min.css" />

  <style>
    html, body { margin: 0; padding: 0; overflow: hidden; }
    #app { height: 100vh; overflow: hidden; }
    .panel-scroll { overflow-y: auto; }
    .panel-scroll::-webkit-scrollbar { width: 4px; }
    .panel-scroll::-webkit-scrollbar-track { background: transparent; }
    .panel-scroll::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }
  </style>

  <script>
    window.APP_CONFIG = {
      salesDeptId:   <?= $salesDeptId ?>,
      bpTemplateId:  <?= $bpTemplateId ?>,
      appEnv:        <?= json_encode(APP_ENV) ?>,
      slotMin:      <?= $slotMin ?>,
      horizonDays:  <?= $horizonDays ?>,
      // Баг 11 fix: pollingMs удалён — автообновление отключено, только ручное.
      minSlots:     <?= $minSlots ?>,
      clientHrMin:  <?= $clientHrMin ?>,
      clientHrMax:  <?= $clientHrMax ?>,
      minMpPerDay:  <?= $minMpPerDay ?>,
      webhookUrl:   <?= json_encode(WEBHOOK_URL) ?>,
      // Текущий пользователь, открывший приложение.
      // В dev-режиме (webhook-shim) используется как MOCK_CURRENT_USER.
      // В iframe-режиме не используется — BX24 SDK возвращает реального юзера сам.
      currentUser:  <?= json_encode($currentUser, JSON_UNESCAPED_UNICODE) ?>
    };
  </script>

  <!--
    === WEBHOOK MODE (автоопределение) ===

    Логика выбора режима:

    1. Если приложение открыто внутри ифрейма Битрикс24 (были переданы
       параметры DOMAIN и APP_SID — они приходят только от самого
       Битрикс24), используем реальный BX24 SDK. Тогда:
         - placement.info() вернёт ID реального текущего лида,
         - user.current вернёт реального пользователя, открывшего приложение,
         - вызовы API идут от имени текущего юзера через OAuth.

    2. Если приложение открыто напрямую (dev/отладка вне ифрейма) —
       включаем webhook-shim. Сам вебхук-клиент берёт leadId из
       URL-параметров ?clientID / ?leadId.

    Раньше флаг был жёстко прибит к true, из-за чего в карточке лида всегда
    показывался mock-лид (или дефолт 59466) и mock-юзер «Тестовый Пользователь».
  -->
  <?php
    // Серверное определение: приложение внутри iframe Битрикс24.
    // DOMAIN — всегда; APP_SID / AUTH_ID / IFRAME=Y — в зависимости от типа плейсмента
    // (в т.ч. SIDE_SLIDER в карточке лида).
    $isInsideBitrix = !empty($_REQUEST['DOMAIN']) && (
        !empty($_REQUEST['APP_SID'])
        || !empty($_REQUEST['AUTH_ID'])
        || (($_REQUEST['IFRAME'] ?? '') === 'Y')
    );
    // Инвертируем: webhook-режим нужен только когда мы НЕ внутри Битрикс24.
    $useWebhook = $isInsideBitrix ? 'false' : 'true';
  ?>
  <script>
    // Автоопределение режима. Значение подставляется сервером как литерал true/false.
    window.APP_USE_WEBHOOK = <?= $useWebhook ?>;
  </script>
  <!-- SDK нужен и в iframe (OAuth), и как база перед webhook-shim в dev. -->
  <script src="//api.bitrix24.com/api/v1/"></script>
  <!-- tz-utils.js должен загружаться ДО webhook-client.js -->
  <script src="assets/tz-utils.js"></script>
  <script src="assets/webhook-client.js"></script>
  <!-- === END: WEBHOOK MODE === -->
</head>

<body class="bg-gray-100 text-gray-800 text-sm antialiased">

<div id="app" class="flex flex-col h-screen">

  <header class="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3 shrink-0">
    <div class="font-bold text-gray-900 text-sm tracking-tight">Анкета</div>
    <div class="w-px h-4 bg-gray-200"></div>
    <div id="lead-title" class="text-xs text-gray-500 truncate">Лид — загрузка...</div>
    <div class="ml-auto flex items-center gap-2 text-xs text-gray-400">
      <span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
      <span id="bx24-user" class="truncate max-w-[160px]">...</span>
    </div>
  </header>

  <div class="flex flex-1 overflow-hidden">

    <div class="flex flex-col border-r border-gray-200 bg-gray-50" style="width:55%;min-width:300px;">

      <div class="bg-white border-b border-gray-100 px-4 py-2 shrink-0">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-semibold text-gray-700">Заполнено полей</span>
          <span id="last-saved" class="text-xs text-gray-400">Не сохранено</span>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div id="progress-bar" class="h-full bg-blue-500 rounded-full transition-all duration-300" style="width:0%"></div>
          </div>
          <span id="progress-label" class="text-xs text-gray-400 whitespace-nowrap">0 / 0</span>
        </div>
      </div>

      <div class="px-4 pt-3 shrink-0">
        <div id="loading" class="flex items-center gap-2 text-gray-400 text-xs py-2">
          <svg aria-hidden="true" class="w-4 h-4 animate-spin text-gray-200 fill-blue-500" viewBox="0 0 100 101" fill="none"><path d="M100 50.6C100 78.2 77.6 100.6 50 100.6S0 78.2 0 50.6 22.4.6 50 .6s50 22.4 50 50z" fill="currentColor"/><path d="M93.97 39.04a4.28 4.28 0 0 1 2.69 5.4 50.04 50.04 0 0 1-12.44 21.54 4.28 4.28 0 0 1-6.05-6.05 41.48 41.48 0 0 0 10.31-17.85 4.28 4.28 0 0 1 5.49-3.04z" fill="currentFill"/></svg>
          <span>Загрузка данных лида...</span>
        </div>
        <div id="error-msg" class="hidden items-center p-3 mb-3 text-sm text-red-800 rounded-lg bg-red-50 border border-red-200" role="alert">
          <svg class="shrink-0 inline w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>
          <span id="error-text"></span>
        </div>
        <div id="success-msg" class="hidden items-center p-3 mb-3 text-sm text-green-800 rounded-lg bg-green-50 border border-green-200" role="alert">
          <svg class="shrink-0 w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
          <span>Анкета сохранена и добавлена в таймлайн.</span>
        </div>
      </div>

      <form id="anketa-form" class="hidden flex-col flex-1 w-full overflow-y-auto overflow-x-hidden" novalidate>
        <div class="flex flex-col gap-3 px-4 py-3 w-full">

          <div class="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold shrink-0">1</span>
              <span class="text-xs font-semibold text-gray-700">Персональные</span>
            </div>
            <div id="personal-body" class="px-3 py-3 flex flex-col gap-2 text-xs"></div>
          </div>

          <div class="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold shrink-0">2</span>
              <span class="text-xs font-semibold text-gray-700">Финансы</span>
            </div>
            <div id="finance-body" class="px-3 py-3 flex flex-col gap-2 text-xs"></div>
          </div>

          <div class="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold shrink-0">3</span>
              <span class="text-xs font-semibold text-gray-700">Кредитная</span>
            </div>
            <div id="credit-body" class="px-3 py-3 flex flex-col gap-2 text-xs"></div>
          </div>

          <div class="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold shrink-0">4</span>
              <span class="text-xs font-semibold text-gray-700">Заметки</span>
            </div>
            <div id="manager-body" class="px-3 py-3 flex flex-col gap-2 text-xs"></div>
          </div>

          <div class="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-bold shrink-0">5</span>
              <span class="text-xs font-semibold text-gray-700">Признаки нецелевой</span>
              <span id="target-status-badge"
                    class="ml-auto inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-yellow-100 text-yellow-800">
                Не определено
              </span>
            </div>
            <div id="netselevoi-body" class="px-3 py-3 flex flex-col gap-2 text-xs"></div>
            <div id="target-status-reasons"
                 class="hidden px-3 py-2 border-t border-gray-100 bg-red-50 text-xs text-red-800">
              <div class="font-semibold mb-1">Причины:</div>
              <ul class="list-disc list-inside space-y-0.5"></ul>
            </div>
          </div>

          <div class="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-500 text-white text-[10px] font-bold shrink-0">6</span>
              <span class="text-xs font-semibold text-gray-700">Запись</span>
            </div>
            <div id="booking-body" class="px-3 py-3 text-xs text-gray-400">
              <span class="inline-flex items-center gap-1.5">
                <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                Выберите слот справа →
              </span>
            </div>
          </div>

        </div>
      </form>

      <div class="bg-white border-t border-gray-200 px-4 py-2 flex items-center gap-2 shrink-0">
        <button id="btn-save" type="submit" form="anketa-form"
                class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-300 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
          Сохранить анкету
        </button>
        <button id="btn-reset" type="button"
                class="inline-flex items-center px-4 py-2 rounded-lg border border-gray-200 bg-white text-xs text-gray-600 hover:bg-gray-50 transition-colors">
          Сбросить
        </button>
        <span id="save-status" class="ml-auto text-xs text-gray-400"></span>
      </div>

    </div>

    <div class="flex flex-col flex-1 bg-gray-50">

      <div class="bg-white border-b border-gray-200 px-4 py-2 shrink-0 flex items-center gap-2">
        <svg class="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        <span class="text-xs font-semibold text-gray-700">Расписание МП</span>
      </div>

      <div class="flex-1 panel-scroll">
        <div class="p-3 space-y-2">

          <div class="bg-white border border-gray-200 rounded-lg px-3 py-2">
            <div class="flex items-center justify-between gap-2">
              <button id="btn-day-prev" type="button"
                      class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 text-xs text-gray-500 hover:bg-gray-100 transition-colors">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
                Пред. день
              </button>
              <div id="schedule-date" class="text-xs font-semibold text-gray-700 text-center"></div>
              <button id="btn-day-next" type="button"
                      class="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 text-xs text-gray-500 hover:bg-gray-100 transition-colors">
                След. день
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
              </button>
            </div>

            <div class="mt-2 pt-2 border-t border-gray-100">
              <button id="btn-refresh-slots" type="button"
                      class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors w-full justify-center">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                Обновить расписание
              </button>
              <div id="refresh-slots-status" class="mt-2 text-[11px] text-gray-400 text-center">
                Ещё не обновляли
              </div>
            </div>
          </div>

          <div id="slots-panel" class="space-y-1"></div>
          <div id="booking-status" class="hidden"></div>

        </div>
      </div>

    </div>

  </div>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/flowbite/2.3.0/flowbite.min.js"></script>

<script src="assets/cities.js"></script>
<script src="assets/mp-config.js"></script>
<script src="assets/target-status.js"></script>

<!-- Yandex.Metrika counter -->
<script type="text/javascript">     (function(m,e,t,r,i,k,a){         m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};         m[i].l=1*new Date();         for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}         k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)     })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=109170927', 'ym');      ym(109170927, 'init', {ssr:true, webvisor:true, trackHash:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true}); </script> <noscript><div><img src="https://mc.yandex.ru/watch/109170927" style="position:absolute; left:-9999px;" alt="" /></div></noscript>
<!-- /Yandex.Metrika counter -->

<!-- app.js — единственная точка входа ES-модулей. -->
<script type="module" src="assets/app.js"></script>

<!--
  Обработчик кнопки «Обновить расписание».
  type="module" выполняется после парсинга DOM (браузер делает это автоматически),
  поэтому DOMContentLoaded не нужен — getElementById сразу находит кнопку.
-->
<script type="module">
  import { setOnRenderComplete } from './assets/calendar-render.js';
  import { loadAllSlots } from './assets/slots.js';

  const btn = document.getElementById('btn-refresh-slots');
  const status = document.getElementById('refresh-slots-status');

  if (btn) {
    btn.addEventListener('click', async function () {
      const icon = btn.querySelector('svg');
      const originalText = 'Обновить расписание';
      const textNode = Array.from(btn.childNodes).find(function (node) {
        return node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '';
      });

      try {
        if (icon) icon.classList.add('animate-spin');
        btn.disabled = true;
        if (textNode) {
          textNode.textContent = ' Обновляем...';
        }
        if (status) {
          status.textContent = 'Идёт обновление расписания...';
        }

        setOnRenderComplete(function () {
          btn.disabled = false;
          if (icon) icon.classList.remove('animate-spin');
          if (textNode) {
            textNode.textContent = ' ' + originalText;
          }
          if (status) {
            const now = new Date();
            status.textContent = 'Обновлено в ' + now.toLocaleTimeString('ru-RU');
          }
        });

        await loadAllSlots();
      } catch (error) {
        console.error('Ошибка при обновлении расписания:', error);
        btn.disabled = false;
        if (icon) icon.classList.remove('animate-spin');
        if (textNode) {
          textNode.textContent = ' ' + originalText;
        }
        if (status) {
          status.textContent = 'Ошибка обновления расписания';
        }
      }
    });
  }
</script>

</body>
</html>
