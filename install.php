<?php
/**
 * install.php — установщик локального приложения «Анкета (МКЦ + МП)»
 *
 * Вызывается Битрикс24 при первой установке приложения.
 * Отображается администратору во фрейме; обычные пользователи видят
 * «Приложение ещё не установлено» до вызова BX24.installFinish().
 *
 * УПРОЩЁННАЯ ВЕРСИЯ:
 *   Все UF-поля лида (как KC_*, так и внешние UF_*) уже созданы в CRM
 *   администратором заранее. Установщик НИЧЕГО НЕ СОЗДАЁТ — он только
 *   интегрирует приложение в карточку лида как вкладку.
 *
 * Порядок работы:
 *   1. BX24.init()
 *   2. app.info → проверка INSTALLED (защита от повторного запуска)
 *   3. placement.bind → зарегистрировать CRM_LEAD_DETAIL_TAB
 *   4. BX24.installFinish() → Битрикс24 считает приложение установленным
 */

// Подключаем конфигурационный файл config.php, который находится в том же каталоге (__DIR__).
// require_once гарантирует, что файл подключится ровно один раз, даже если
// install.php каким-то образом будет включён несколько раз.
// Из config.php берутся константы: PORTAL_URL, SALES_DEPT_ID, BP_TEMPLATE_ID и др.
require_once __DIR__ . '/config.php';

// Определяем хост портала, на котором установлено приложение.
// Битрикс24 при открытии install.php во фрейме всегда передаёт параметр DOMAIN
// в строке запроса (например: ?DOMAIN=dev.yurclick.com&PROTOCOL=1&...).
// Это позволяет одному и тому же коду работать на любом портале — dev, prod, копии —
// без правки config.php. Если DOMAIN не передан (например, при ручном открытии страницы),
// фоллбэк на PORTAL_URL из config.php.
$portalDomain = isset($_REQUEST['DOMAIN']) && $_REQUEST['DOMAIN'] !== ''
    ? $_REQUEST['DOMAIN']
    : parse_url(PORTAL_URL, PHP_URL_HOST);

// Схема (http/https): Битрикс24 передаёт PROTOCOL=1 для https и PROTOCOL=0 для http.
// По умолчанию используем https.
$portalScheme = (isset($_REQUEST['PROTOCOL']) && $_REQUEST['PROTOCOL'] === '0')
    ? 'http'
    : 'https';

// htmlspecialchars — экранирует спецсимволы для безопасной вставки в HTML-атрибут
// (защита от XSS на случай мусора в параметрах запроса).
$portalHost = htmlspecialchars($portalDomain, ENT_QUOTES);

// URL обработчика виджета — адрес index.php в том же каталоге anketa-kc/.
// HANDLER берётся из реального портала, на котором запущен установщик ($portalScheme + $portalDomain),
// чтобы вкладка регистрировалась с правильным хостом независимо от того,
// что прописано в PORTAL_URL.
$handlerUrl = $portalScheme . '://apcheit.ru/yurclick/anketa-kc/index.php';

// URL этой страницы установки (для дебага: откуда грузится iframe).
$installPageUrl = $portalScheme . '://apcheit.ru/yurclick/anketa-kc/install.php';
?>
<!DOCTYPE html>
<!-- Объявление типа документа HTML5. Обязательно для корректного рендеринга в браузере. -->
<html lang="ru">
<!-- Атрибут lang="ru" сообщает браузерам и поисковикам язык страницы — русский. -->
<head>
  <!-- Мета-тег кодировки: все символы страницы интерпретируются в UTF-8.
       Должен стоять первым в <head>, чтобы браузер правильно читал кириллицу. -->
  <meta charset="UTF-8">

  <!-- Мета-тег адаптивности: отключает масштабирование на мобильных устройствах.
       width=device-width — ширина viewport = ширина экрана устройства.
       initial-scale=1.0 — начальный зум = 100%.
       Важно для корректного отображения Tailwind-утилит на планшетах/телефонах. -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Заголовок вкладки браузера. Отображается в заголовке фрейма Битрикс24. -->
  <title>Установка — Анкета (МКЦ + МП)</title>

  <!-- BX24 JS SDK: официальная клиентская библиотека Битрикс24 REST API.
       Подключается с официального CDN api.bitrix24.com — рекомендованный способ
       (см. dev.1c-bitrix.ru/rest_help/js_library/). SDK универсальный и работает
       с любым порталом, включая коробочные/self-hosted версии (как dev.yurclick.com),
       где у самого портала может не быть статики /bitrix/js/rest/bx24.js.
       Без указания протокола (//) — браузер использует https автоматически. -->
  <script src="//api.bitrix24.com/api/v1/"></script>

  <!-- Tailwind CSS v4 CDN: утилитарный CSS-фреймворк.
       Версия @tailwindcss/browser@4 — браузерная сборка, компилирующая классы на лету.
       Используется единый стек со всем приложением (install, uninstall, index.php). -->
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>

  <style>
    /* Глобальный сброс отступов для html и body.
       По умолчанию браузеры добавляют margin/padding на тело страницы.
       Обнуляем, чтобы контент занимал всю площадь фрейма Битрикс24 без лишних полей. */
    html, body { margin: 0; padding: 0; }
  </style>
</head>

<!-- bg-gray-50: светло-серый фон страницы — соответствует фирменному стилю приложения.
     text-gray-800: основной цвет текста — тёмно-серый, не чёрный, мягче для глаз.
     text-sm: базовый размер шрифта 14px.
     antialiased: сглаживание шрифтов на WebKit/Gecko — улучшает читаемость. -->
<body class="bg-gray-50 text-gray-800 text-sm antialiased">

<!-- Центральный контейнер страницы установки.
     max-w-xl: максимальная ширина 576px — не даёт контенту растягиваться на широких экранах.
     mx-auto: центрирование по горизонтали.
     px-6 py-8: горизонтальные отступы 24px, вертикальные 32px. -->
<div class="max-w-xl mx-auto px-6 py-8">

  <!-- ── Заголовок страницы установки ── -->

  <!-- text-lg font-bold: крупный жирный заголовок h1 (18px).
       text-gray-900: почти чёрный — максимальный контраст для заголовка.
       mb-1: небольшой нижний отступ перед подзаголовком. -->
  <h1 class="text-lg font-bold text-gray-900 mb-1">Установка приложения «Анкета»</h1>

  <!-- Подзаголовок поясняет администратору, что именно происходит во время установки:
       регистрируется вкладка в карточке лида CRM. UF-поля уже созданы заранее.
       text-xs text-gray-500: мелкий серый текст — второстепенная информация.
       mb-6: нижний отступ 24px перед блоком прогресса. -->
  <p class="text-xs text-gray-500 mb-6">Регистрация вкладки приложения в карточке лида CRM. Пользовательские поля уже созданы заранее и не затрагиваются установщиком.</p>

  <!-- ── Блок прогресс-бара ──
       Показывает текущий шаг установки (название) и счётчик шагов (N / M).
       Обновляется JavaScript-функцией setStep(label, current, total). -->
  <div class="mb-4">
    <!-- Строка с названием шага и счётчиком — расположены на одной линии, крайние. -->
    <div class="flex items-center justify-between mb-1">
      <!-- step-label: текстовое название текущего шага.
           Изначально содержит «Инициализация...» — до готовности BX24 SDK.
           text-xs font-medium text-gray-600: мелкий, полужирный, серый. -->
      <span id="step-label" class="text-xs font-medium text-gray-600">Инициализация...</span>

      <!-- step-counter: счётчик вида «1 / 2» — номер текущего шага из общего числа.
           Изначально пуст; заполняется функцией setStep().
           text-xs text-gray-400: мелкий светло-серый. -->
      <span id="step-counter" class="text-xs text-gray-400"></span>
    </div>

    <!-- Контейнер полосы прогресса.
         w-full: занимает всю ширину родителя.
         h-2: высота 8px.
         bg-gray-200: светло-серый фон трека (незаполненная часть).
         rounded-full overflow-hidden: скруглённые края и обрезка выступающего дочернего элемента. -->
    <div class="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
      <!-- progress-bar: заполненная (синяя) часть прогресс-бара.
           h-full: высота 100% от родителя (8px).
           bg-blue-500: синий цвет прогресса.
           rounded-full: скруглённые края.
           transition-all duration-300: плавная CSS-анимация изменения ширины за 300мс.
           style="width:0%": начальное состояние — 0%.
           JavaScript меняет width через element.style.width = 'N%' в функции setStep(). -->
      <div id="progress-bar" class="h-full bg-blue-500 rounded-full transition-all duration-300" style="width:0%"></div>
    </div>
  </div>

  <!-- ── Блок лога (консоль установки) ──
       Каждое событие установки добавляется сюда JavaScript-функцией log().
       Администратор видит подробный ход процесса в реальном времени.
       bg-white border border-gray-200 rounded-lg: белая карточка с рамкой.
       p-3: внутренние отступы 12px.
       text-xs text-gray-600: мелкий серый текст.
       space-y-1: вертикальный отступ 4px между строками лога.
       max-h-72: максимальная высота 288px (18rem) — при переполнении появляется скролл.
       overflow-y-auto: вертикальная прокрутка при переполнении.
       font-mono: моноширинный шрифт — стандарт для консольного вывода. -->
  <div id="log" class="bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-600 space-y-1 max-h-72 overflow-y-auto font-mono"></div>

  <!-- ── Блок ошибки ──
       Скрыт (hidden) по умолчанию.
       Показывается функцией showError(msg): убирает класс 'hidden', выводит сообщение об ошибке.
       bg-red-50 border border-red-200 text-red-800: красная палитра для сигнала об ошибке.
       mt-4 p-3 rounded-lg: отступ сверху, внутренние отступы, скруглённые углы. -->
  <div id="error-block" class="hidden mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800"></div>

  <!-- ── Блок успеха ──
       Скрыт (hidden) по умолчанию.
       Показывается функцией showSuccess(msg): убирает класс 'hidden', выводит итоговое сообщение.
       bg-green-50 border border-green-200 text-green-800: зелёная палитра — всё прошло успешно.
       Отображается после вызова finishInstall() в конце цепочки установки. -->
  <div id="success-block" class="hidden mt-4 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800"></div>

</div>

<script>
// Включаем строгий режим JavaScript: запрещает использование необъявленных переменных,
// неявный this, устаревшие синтаксисы. Помогает ловить ошибки на этапе выполнения.
'use strict';

// ─── Конфиг: URL обработчика виджета (из PHP) ────────────────────────────────
// HANDLER_URL передаётся из PHP в JavaScript через json_encode.
// json_encode($handlerUrl, ...) — сериализует PHP-строку в валидный JSON-литерал (строку с кавычками),
// JSON_UNESCAPED_UNICODE — кириллица не экранируется в \uXXXX, остаётся читаемой,
// JSON_UNESCAPED_SLASHES — слеши / не экранируются в \/,
// что делает URL компактным и читаемым в исходном коде.
// Результат вставляется непосредственно в JS: var HANDLER_URL = "https://...";
var HANDLER_URL = <?= json_encode($handlerUrl, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>;

// Контекст страницы (PHP) — для дебага: куда смотрит установщик до BX24.init.
var INSTALL_CTX = {
  appEnv: <?= json_encode(APP_ENV, JSON_UNESCAPED_UNICODE) ?>,
  portalHost: <?= json_encode($portalHost, JSON_UNESCAPED_UNICODE) ?>,
  handlerUrl: HANDLER_URL,
  installPageUrl: <?= json_encode($installPageUrl, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>,
  requestDomain: <?= json_encode($_REQUEST['DOMAIN'] ?? '', JSON_UNESCAPED_UNICODE) ?>,
  requestProtocol: <?= json_encode($_REQUEST['PROTOCOL'] ?? '', JSON_UNESCAPED_UNICODE) ?>
};

// ─── UI-хелперы ──────────────────────────────────────────────────────────────
// Набор утилитарных функций для обновления интерфейса без дублирования кода.

/**
 * log(msg) — добавляет строку в консольный блок лога (#log).
 * Используется на каждом шаге установки для информирования администратора.
 *
 * @param {string} msg — текст строки лога.
 */
function log(msg) {
  // Ищем DOM-элемент блока лога по его id.
  var el = document.getElementById('log');
  // Защитная проверка: если элемент не найден (например, DOM не готов) — выходим без ошибки.
  if (!el) return;
  // Создаём новый div-элемент для одной строки лога.
  var line = document.createElement('div');
  // Устанавливаем текст строки. textContent (не innerHTML) — безопасно, без XSS.
  line.textContent = msg;
  // Добавляем строку в конец блока лога.
  el.appendChild(line);
  // Прокручиваем блок лога вниз, чтобы последняя строка всегда была видна.
  // scrollTop = scrollHeight — программно перематывает к самому концу прокручиваемой области.
  el.scrollTop = el.scrollHeight;
}

/**
 * setStep(label, current, total) — обновляет прогресс-бар и счётчик шагов.
 * Вызывается перед каждым API-запросом, чтобы администратор видел прогресс в реальном времени.
 *
 * @param {string} label   — название текущего шага (например «Регистрация вкладки»).
 * @param {number} current — номер текущего шага (1-based).
 * @param {number} total   — общее количество шагов. Если 0 или falsy — счётчик скрывается.
 */
function setStep(label, current, total) {
  // Получаем ссылки на DOM-элементы один раз в начале функции.
  var stepLabel   = document.getElementById('step-label');   // текстовый заголовок шага
  var stepCounter = document.getElementById('step-counter'); // счётчик «N / M»
  var bar         = document.getElementById('progress-bar'); // заполненная полоса прогресса

  // Обновляем текст заголовка шага, если элемент существует.
  if (stepLabel)   stepLabel.textContent   = label;

  // Обновляем счётчик: показываем «current / total» или пустую строку, если total не задан.
  if (stepCounter) stepCounter.textContent = total ? (current + ' / ' + total) : '';

  // Вычисляем процент выполнения и обновляем ширину полосы.
  // Math.round — округляем до целого, чтобы не было дробных пикселей.
  // bar.style.width — CSS-свойство, анимируется transition-all duration-300 из HTML.
  if (bar && total) bar.style.width = Math.round((current / total) * 100) + '%';
}

/**
 * showError(msg) — показывает блок ошибки (#error-block) и дублирует сообщение в лог.
 * Вызывается при любом сбое API-метода, после чего установка прерывается.
 *
 * @param {string} msg — текст ошибки.
 */
function showError(msg) {
  var el = document.getElementById('error-block');
  if (el) {
    // Устанавливаем текст ошибки в красный блок.
    el.textContent = msg;
    // Убираем класс 'hidden' — блок становится видимым (display: block).
    el.classList.remove('hidden');
  }
  // Дублируем ошибку в лог с префиксом «ОШИБКА:» для визуальной отметки.
  log('ОШИБКА: ' + msg);
}

/**
 * showSuccess(msg) — показывает зелёный блок успеха (#success-block) и пишет в лог.
 * Вызывается в самом конце установки из функции finishInstall().
 *
 * @param {string} msg — итоговое сообщение об успешной установке.
 */
function showSuccess(msg) {
  var el = document.getElementById('success-block');
  if (el) {
    // Устанавливаем текст в зелёный блок.
    el.textContent = msg;
    // Убираем 'hidden' — делаем блок видимым.
    el.classList.remove('hidden');
  }
  // Дублируем в лог: последняя строка консоли = итоговый результат.
  log(msg);
}

/**
 * logJson(label, obj) — сериализует объект в лог (для ответов REST).
 */
function logJson(label, obj) {
  try {
    log(label + ': ' + JSON.stringify(obj, null, 2));
  } catch (e) {
    log(label + ': [не удалось сериализовать] ' + String(obj));
  }
}

/**
 * logInstallContext() — где физически выполняется код и куда пойдут запросы.
 */
function logInstallContext() {
  log('─── DEBUG: контекст страницы ───');
  log('  Наш сервер (HTML install.php): ' + INSTALL_CTX.installPageUrl);
  log('  Handler вкладки (index.php): ' + INSTALL_CTX.handlerUrl);
  log('  APP_ENV (config.php по HTTP_HOST): ' + INSTALL_CTX.appEnv);
  log('  DOMAIN из query (?DOMAIN=): ' + (INSTALL_CTX.requestDomain || '(не передан)'));
  log('  Портал для handler: ' + INSTALL_CTX.portalHost);
  log('  ВАЖНО: флаг INSTALLED хранится на портале Битрикс24, не на нашем PHP.');
}

/**
 * logBx24Auth() — REST endpoint и домен, куда BX24.callMethod шлёт запросы.
 */
function logBx24Auth() {
  if (typeof BX24.getAuth !== 'function') {
    log('DEBUG: BX24.getAuth недоступен (SDK не в iframe портала?)');
    return;
  }
  var auth = BX24.getAuth();
  log('─── DEBUG: куда уходят REST (BX24.getAuth) ───');
  log('  domain (портал): ' + (auth.domain || auth.DOMAIN || '?'));
  log('  client_endpoint: ' + (auth.client_endpoint || auth.CLIENT_ENDPOINT || '?'));
  log('  server_endpoint: ' + (auth.server_endpoint || auth.SERVER_ENDPOINT || '?'));
  log('  member_id: ' + (auth.member_id || auth.MEMBER_ID || '?'));
  log('  → app.info / placement.bind: POST на client_endpoint + имя метода');
}

/**
 * logRestCall(method, params) — какой метод REST вызываем и с какими параметрами.
 */
function logRestCall(method, params) {
  log('REST → ' + method + (params && Object.keys(params).length ? ' ' + JSON.stringify(params) : ' {}'));
}

// ─── Точка входа: запуск установки ────────────────────────────────────────────

/**
 * BX24.init(callback) — инициализация SDK Битрикс24.
 * Callback вызывается, когда:
 *   1. Библиотека bx24.js загружена и распарсена,
 *   2. Токены аутентификации получены от родительского окна Битрикс24,
 *   3. iframe встроен и готов к API-вызовам.
 * Все вызовы BX24.callMethod() должны делаться ТОЛЬКО внутри BX24.init().
 */
BX24.init(function () {
  // Логируем готовность SDK в консоль установщика — администратор видит прогресс.
  log('BX24.init — SDK готов');
  logInstallContext();
  logBx24Auth();

  // ── Шаг 1: проверить, не установлено ли приложение уже ────────────────────
  // Зачем: если пользователь случайно повторно открыл страницу установки,
  // мы не должны перерегистрировать placement.
  // API-метод app.info возвращает информацию о текущем приложении, в том числе
  // поле INSTALLED: true/false — флаг завершённой установки (после installFinish).

  setStep('Проверка статуса приложения...', 1, 2);

  log('─── Шаг 1: app.info (чтение статуса на портале Б24) ───');
  logRestCall('app.info', {});

  BX24.callMethod(
    'app.info',  // Метод REST API: возвращает данные о текущем приложении
    {},          // Параметры: пусто — метод не принимает фильтров
    function (infoRes) {
      // infoRes — объект ответа BX24 SDK.
      // infoRes.error() — возвращает объект ошибки или null при успехе.
      if (infoRes.error()) {
        // Если app.info вернул ошибку — показываем сообщение и прерываем установку.
        log('DEBUG app.info ERROR: ' + String(infoRes.error()));
        showError('Ошибка app.info: ' + infoRes.error());
        return; // Прерываем выполнение колбэка
      }

      // infoRes.data() — JavaScript-объект с данными ответа.
      // INSTALLED: true — Битрикс24 уже зафиксировал завершение установки (installFinish был вызван ранее).
      var appData = infoRes.data();
      logJson('DEBUG app.info ответ (источник: REST портала)', appData);
      log('DEBUG INSTALLED=' + appData.INSTALLED + ' (true = installFinish уже вызывали на этом портале)');
      if (appData.INSTALLED) {
        // Повторная установка не нужна — сообщаем об этом и останавливаемся.
        log('DEBUG: выход без placement.bind — статус уже в БД приложений портала Б24');
        showSuccess('Приложение уже установлено. Повторная установка не требуется.');
        setStep('Готово', 2, 2); // Прогресс-бар = 100%
        return; // Выходим из колбэка — дальнейшая цепочка не запускается
      }

      // INSTALLED = false → приложение устанавливается впервые.
      log('Статус: приложение ещё не установлено → регистрация вкладки');
      // Переходим к следующему шагу — регистрации вкладки в карточке лида.
      bindPlacement();
    }
  );
});

// ─── Шаг 2: регистрация вкладки CRM_LEAD_DETAIL_TAB ─────────────────────────
// Зачем: приложение должно быть видно в карточке лида как отдельная вкладка «Анкета».
// placement.bind регистрирует «placement» — точку встройки виджета в интерфейс Битрикс24.

function bindPlacement() {
  setStep('Регистрация вкладки в карточке лида...', 2, 2);

  var bindParams = {
    PLACEMENT: 'CRM_LEAD_DETAIL_TAB',
    HANDLER:   HANDLER_URL,
    TITLE:     'Анкета',
    LANG_ALL: {
      ru: { TITLE: 'Анкета' },
      en: { TITLE: 'Questionnaire' }
    }
  };

  log('─── Шаг 2: placement.bind (запись на портале Б24) ───');
  log('  HANDLER — URL, который Б24 подгрузит во вкладку лида: ' + HANDLER_URL);
  logRestCall('placement.bind', bindParams);

  BX24.callMethod(
    'placement.bind',          // Метод REST API: регистрирует встройку приложения
    bindParams,
    function (bindRes) {

      logJson('DEBUG placement.bind ответ', bindRes);

      if (bindRes.error()) {
        // Анализируем текст ошибки: повторная привязка того же placement не критична.
        var errMsg = String(bindRes.error());
        log('DEBUG placement.bind ERROR: ' + errMsg);

        // Если placement уже зарегистрирован (например, частичная переустановка),
        // не прерываем процесс — продолжаем к installFinish.
        // Битрикс24 возвращает 'ERROR_PLACEMENT_HANDLER_ALREADY_BINDED' или похожий код.
        if (errMsg.indexOf('ALREADY_BINDED') !== -1 || errMsg.indexOf('already') !== -1) {
          log('  ⚠ Вкладка уже зарегистрирована (пропуск)');
          finishInstall();
          return;
        }

        // Ошибка регистрации вкладки — критическая: приложение будет недоступно из CRM.
        showError('Ошибка placement.bind: ' + bindRes.error());
        return;
      }
      logJson('DEBUG placement.bind ответ', bindRes.data());
      log('  ✓ Вкладка «Анкета» зарегистрирована на портале (таблица placement\'ов Б24)');
      // Переходим к последнему шагу — завершению установки.
      finishInstall();
    }
  );
}

// ─── Шаг 3: завершение установки ─────────────────────────────────────────────
// Финальный шаг: сигнализируем Битрикс24, что установка завершена.

function finishInstall() {
  // Устанавливаем прогресс-бар в 100% (current=2, total=2).
  setStep('Готово', 2, 2);

  // Показываем итоговое сообщение в зелёном блоке.
  showSuccess(
    'Установка завершена. ' +
    'Вкладка «Анкета» зарегистрирована в карточке лида. ' +
    'Пользовательские поля используются из уже существующих в CRM.'
  );
  log('─── Шаг 3: BX24.installFinish() ───');
  log('  Не REST и не наш PHP: postMessage в родительское окно портала Битрикс24.');
  log('  Портал выставляет INSTALLED=true в своей БД приложений (тот же флаг, что читает app.info).');
  log('BX24.installFinish() — вызов...');

  /**
   * BX24.installFinish() — специальный метод SDK, сигнализирующий платформе
   * о завершении процесса установки приложения.
   *
   * После его вызова происходит следующее:
   *   1. Битрикс24 устанавливает флаг INSTALLED = true для приложения.
   *   2. Встройки (placement'ы) приложения становятся видны всем пользователям портала.
   *   3. Обработчики событий приложения активируются.
   *   4. Страница install.php автоматически перезагружается и открывается
   *      стартовый экран приложения (если задан в настройках приложения).
   *
   * ВАЖНО: без вызова installFinish() Битрикс24 будет показывать всем пользователям
   * сообщение «Приложение ещё не установлено» вместо самого приложения.
   */
  BX24.installFinish();
}
</script>

</body>
</html>
