/**
 * app.js — инициализация приложения
 *
 * Порядок работы после загрузки страницы:
 * 1. BX24.init → получаем leadId из placement (параметры плейсмента Bitrix24)
 * 2. batch: crm.lead.get + user.current — загружаем данные лида и текущего пользователя одним пакетным запросом
 * 3. Заполняем шапку: имя текущего пользователя + заголовок лида
 * 4. initForm(lead)     — рендер полей формы анкеты, в т.ч. KC_CLIENT_CITY (город клиента)
 * 5. setClientCity(city, true)  — передаём город в silent-режиме: только устанавливает _clientUtc,
 *                                  НЕ вызывает loadAllSlots (избегаем двойного запроса слотов)
 * 6. initCalendar()             — теперь _clientUtc уже установлен корректно, вызывает loadAllSlots один раз
 * 7. startPolling()             — запускает периодическую проверку обновлений (опрос сервера)
 */

// ES-модуль: 'use strict' включён автоматически. После задачи 4 app.js —
// единственная точка входа (type="module" в index.php), импортирует все
// остальные модули через ES-import.

import { AppState } from './app-state.js';
import { logEvent } from './logger-client.js';
import { initForm, updateProgress, updateTargetStatusWidget } from './form-init.js';
import { saveForm, collectFormData } from './form-submit.js';
import { initCalendar, setOnRenderComplete } from './calendar-render.js';
import { setClientCity, loadAllSlots } from './slots.js';
import { fitWindow, fitWindowNow } from './resize-window.js';
// target-status.js, mp-config.js, cities.js, webhook-client.js, tz-utils.js —
// не модули и подключаются отдельными <script> до этого app.js. Они
// экспортируют функции через window и используются здесь как глобалы.

// Re-export через window — чтобы инлайн-обработчики в index.php (если есть)
// и target-status.js могли по-старому обращаться к функциям. После полного
// перехода всех файлов на модули эту секцию можно удалить.
window.initForm = initForm;
window.updateProgress = updateProgress;
window.updateTargetStatusWidget = updateTargetStatusWidget;
window.saveForm = saveForm;
window.collectFormData = collectFormData;
window.initCalendar = initCalendar;
window.setClientCity = setClientCity;
// fix: пробрасываем loadAllSlots в window, чтобы инлайн-обработчик
// кнопки #btn-refresh-slots в index.php мог её вызвать напрямую.
// ES-модули изолированы — без этой строки window.loadAllSlots === undefined.
window.loadAllSlots = loadAllSlots;
// fix: пробрасываем setOnRenderComplete в window, потому что инлайн-скрипт
// index.php не может напрямую присвоить export let _onRenderComplete внутри ES-модуля.
// Вызов window.setOnRenderComplete(fn) меняет переменную внутри модуля через сеттер.
window.setOnRenderComplete = setOnRenderComplete;

// ПРИМЕЧАНИЕ: leadId / currentUser / CURRENT_USERNAME больше не глобальные let —
// они хранятся в AppState (см. anketa-kc/assets/app-state.js). Если placement.info()
// и URL-параметры не дали ID лида, app.js показывает явную ошибку — хардкодить
// дефолтный ID лида (старая отладочная схема) больше не нужно.

// AppState теперь импортируется напрямую (см. import выше).
// window.AppState также сохранён в app-state.js на переходный период
// для модулей, которые ещё не перешли на ES-import.

// Запускаем инициализацию приложения через SDK Bitrix24
// Callback выполняется только после того, как BX24 готов к работе
// Логируем запуск приложения — до получения leadId и пользователя.
logEvent('APP_START', { url: window.location.href });

BX24.init(function () {

  // fitWindow вызывается точечно (после рендера и при сообщениях об ошибке),
  // а не через всегда-включённый MutationObserver: при фиксированном макете
  // (#app height:100vh; overflow:hidden — см. docs/design-system.md и
  // fit-window.js) подгонять нечего, а лишние вызовы давали бы только шум.
  // Вне iframe Битрикс24 (dev/standalone) каждый вызов — безопасный no-op.

  // Получаем информацию о текущем плейсменте (месте встраивания приложения в Bitrix24)
  // Определяем ID лида из двух возможных источников:
  //
  // 1) Плейсмент CRM_LEAD_DETAIL_TAB — основной сценарий: вкладка внутри карточки
  //    лида. Битрикс24 передаёт ID лида в placement.options.ID.
  //
  // 2) URL-параметр clientID / leadID — фоллбэк для случаев, когда
  //    приложение открыто не через плейсмент (прямая ссылка на index.php
  //    для QA/отладки или открытие в отдельном окне). Поддерживаются
  //    оба названия параметра: clientID (использует сам Битрикс24 в
  //    URL карточки лида) и leadID (явный вариант).

  // Приоритет 1: плейсмент. Опциональная цепочка ?. защищает от ошибки,
  // если placement.info() вернёт null/undefined вне контекста плейсмента.
  const placement = BX24.placement.info();
  let leadId = parseInt(placement?.options?.ID, 10);

  // Приоритет 2: URL-параметры. Достаём только если из плейсмента ничего
  // не пришло. URLSearchParams работает с location.search текущего iframe,
  // куда Битрикс24 подкладывает ?DOMAIN=...&PROTOCOL=1&...&clientID=NNN.
  if (!leadId) {
    const params = new URLSearchParams(window.location.search);
    leadId = parseInt(
      params.get('clientID') || params.get('leadID') || params.get('leadId'),
      10
    );
  }

  // Ни плейсмент, ни URL не дали корректный ID — работать не с чем.
  if (!leadId) {
    const errMsg = 'Не удалось получить ID лида: ни placement.options.ID, ни ?clientID/?leadID в URL.';
    logEvent('LEAD_ID_MISSING', { placementOptions: placement?.options ?? null });
    showError(errMsg);
    return; // Без ID лида инициализация невозможна.
  }

  // Сохраняем leadId в AppState, чтобы form.js / calendar.js читали его явно
  // через AppState.get('leadId'), а не напрямую из глобальной переменной.
  AppState.set('leadId', leadId);

  // Отправляем пакетный запрос к API Bitrix24 сразу двумя методами за один вызов
  // Это эффективнее, чем делать два отдельных запроса последовательно
  BX24.callBatch(
    {
      // Первый запрос: получаем данные лида по его ID
      getLead:        ['crm.lead.get',  { id: leadId }],

      // Второй запрос: получаем данные текущего авторизованного пользователя
      getCurrentUser: ['user.current',  {}]
    },

    // Callback-функция вызывается после того, как оба запроса завершились
    function (results) {

      // Проверяем, не вернул ли запрос данных лида ошибку
      if (results.getLead.error()) {
        const errMsg = `Ошибка загрузки лида: ${results.getLead.error()}`;
        logEvent('LEAD_LOAD_ERROR', { leadId: leadId, error: String(results.getLead.error()) });
        showError(errMsg);
        return; // Дальнейшая работа без данных лида невозможна
      }

      // Извлекаем объект с полями лида из успешного ответа
      const lead = results.getLead.data();
      logEvent('LEAD_LOADED', { leadId: leadId, title: lead.TITLE || '' });

      // Извлекаем объект с данными текущего пользователя из ответа и сохраняем в AppState.
      const currentUser = results.getCurrentUser.data();
      AppState.set('currentUser', currentUser);

      // Сохраняем ID связанного контакта из лида в AppState.
      // Используется в form-submit.js для обновления ФИО контакта при сохранении анкеты.
      // CONTACT_ID приходит как строка из REST API — parseInt приводит к числу,
      // при отсутствии контакта (null / '') сохраняется null.
      const contactId = parseInt(lead.CONTACT_ID, 10) || null;
      AppState.set('contactId', contactId);

      // SECOND_NAME у части пользователей приходит как undefined, у других —
      // как пустая строка ''; зависит от версии REST API и настроек портала.
      // filter(Boolean) одновременно отсекает оба варианта — иначе при
      // отсутствии отчества получили бы двойной пробел между именем и
      // фамилией («Иванов  Алексей»). Строка-заглушка 'Пользователь' нужна,
      // чтобы шапка не оказалась пустой, если REST вернёт пользователя
      // вообще без полей имени (бывает у системных учёток).
      const currentUsername = [
        currentUser.LAST_NAME,   // Фамилия пользователя
        currentUser.NAME,        // Имя пользователя
        currentUser.SECOND_NAME  // Отчество пользователя
      ].filter(Boolean).join(' ').trim() || 'Пользователь';
      AppState.set('currentUsername', currentUsername);

      // Находим элемент заголовка лида в DOM по его идентификатору
      const titleEl = document.getElementById('lead-title');

      // Если элемент найден — записываем в него заголовок лида, или запасной текст с номером лида
      if (titleEl) titleEl.textContent = lead.TITLE || (`Лид #${leadId}`);

      // Находим элемент для отображения имени текущего пользователя в шапке
      const userEl = document.getElementById('bx24-user');

      // Если элемент найден — записываем в него сформированное ФИО пользователя
      if (userEl) userEl.textContent = currentUsername;

      // Находим элемент индикатора загрузки (спиннер / текст "загрузка...")
      const loading = document.getElementById('loading');

      // Спиннер скрываем именно сейчас, а не раньше: до этого момента lead
      // ещё мог не прийти, и пользователь увидел бы пустую форму без понимания,
      // что данные грузятся. После успешного callBatch отображать спиннер уже
      // вредно — он выглядит как зависание.
      if (loading) loading.classList.add('hidden');

      // Находим элемент формы анкеты
      const form = document.getElementById('anketa-form');

      // Класс .hidden задаёт display:none с !important — снимать его одного
      // классом недостаточно, потому что Tailwind-каскад в некоторых случаях
      // переопределяет display обратно на none. Inline-стиль имеет
      // максимальный приоритет и гарантирует видимость формы.
      // Форма теперь — обычный блок (как в прототипе): скроллится её
      // родитель-обёртка, а не сама форма, поэтому display:block.
      if (form) {
        form.classList.remove('hidden');   // Убираем скрывающий CSS-класс
        form.style.display = 'block';      // см. комментарий выше — нужен поверх каскада
      }

      // Если функция initForm определена (подключён соответствующий скрипт) — вызываем её
      // Передаём объект лида, чтобы функция могла предзаполнить поля формы данными из Bitrix24
      if (typeof initForm === 'function') initForm(lead);

      // Если функция setClientCity определена — устанавливаем город клиента
      // Берём значение поля UF_CRM_1521214081 из лида, обрезаем пробелы
      // Второй аргумент true = silent-режим: только сохраняет UTC-смещение города,
      // но НЕ запускает загрузку слотов календаря, чтобы избежать двойного запроса
      if (typeof setClientCity === 'function') {
        setClientCity((lead.UF_CRM_1521214081 || '').trim(), true);
      }

      // Если функция initCalendar определена — инициализируем календарь выбора даты/времени
      // К этому моменту UTC-смещение клиента уже установлено через setClientCity,
      // поэтому loadAllSlots внутри initCalendar выполнится один раз с корректным смещением
      if (typeof initCalendar  === 'function') initCalendar();

      // Если функция startPolling определена — запускаем периодический опрос сервера
      // Это нужно для автоматического обновления данных (например, статуса слотов) без перезагрузки страницы
      if (typeof startPolling  === 'function') startPolling();

      // Форма и календарь отрисованы — просим портал подогнать высоту фрейма
      // под итоговый контент. При текущем фиксированном макете это no-op, но
      // вызов корректен и сработает, если макет станет «растущим под контент».
      fitWindow();

      logEvent('APP_READY', { leadId: leadId });
    }
  );
});

/**
 * showError — отображает сообщение об ошибке на странице.
 *
 * Скрывает индикатор загрузки и показывает блок с текстом ошибки.
 *
 * @param {string} msg — текст сообщения об ошибке для отображения пользователю
 */
function showError(msg) {

  // Находим индикатор загрузки и скрываем его — ошибка заменяет состояние "загрузки"
  const loading = document.getElementById('loading');
  if (loading) loading.classList.add('hidden'); // Скрываем спиннер/текст загрузки

  // Находим контейнер блока ошибки и элемент с текстом внутри него
  const wrap = document.getElementById('error-msg');   // Обёртка блока ошибки
  const text = document.getElementById('error-text');  // Элемент для текста ошибки

  // Если оба элемента существуют в DOM — заполняем и показываем блок ошибки
  if (wrap && text) {
    text.textContent = msg;           // Записываем текст ошибки в элемент
    wrap.classList.remove('hidden');  // Убираем скрывающий класс, чтобы блок стал видимым
    wrap.classList.add('flex');       // Добавляем flex-отображение для корректного позиционирования
  }

  // Блок ошибки мог изменить высоту контента — просим портал подогнать фрейм
  // немедленно (без дебаунса). При фиксированном макете — no-op, см. fit-window.js.
  fitWindowNow();
}

/**
 * showSuccess — отображает уведомление об успешном сохранении данных.
 *
 * Показывает блок успеха с текущим временем сохранения,
 * а затем автоматически скрывает его через 4 секунды.
 */
function showSuccess() {

  // Находим элемент уведомления об успехе по идентификатору
  const el = document.getElementById('success-msg');

  // Если элемент не найден в DOM — выходим из функции, чтобы избежать ошибок
  if (!el) return;

  // Делаем блок успеха видимым: убираем скрывающий класс и добавляем flex-отображение
  el.classList.remove('hidden'); // Убираем скрытие
  el.classList.add('flex');      // Включаем flex для корректной вёрстки уведомления

  // Получаем текущую дату и время для отображения в уведомлении
  const now     = new Date();

  // Форматируем время в формате "ЧЧ:ММ" по русской локали (например, "14:35")
  const timeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  // Находим элемент статуса сохранения (обычно небольшая строка под кнопкой "Сохранить")
  const status = document.getElementById('save-status');

  // Если элемент статуса найден — обновляем его текст с указанием времени сохранения
  if (status) status.textContent = `Сохранено в ${timeStr}`;

  // Находим элемент "последнее сохранение" (может отображаться в другом месте интерфейса)
  const saved = document.getElementById('last-saved');

  // Если элемент найден — записываем в него время последнего успешного сохранения
  if (saved) saved.textContent = `Сохранено в ${timeStr}`;

  // 4000 мс выбрано после тестирования на узких экранах (мобильный, ширина 320px):
  // при 2000–3000 мс пользователь не успевает прочитать «Сохранено в HH:MM» —
  // взгляд уходит на следующий блок. При 5000+ мс уведомление мешает
  // следующему действию (например, бронированию слота сразу после сохранения).
  setTimeout(function () {
    el.classList.add('hidden');    // Скрываем блок уведомления
    el.classList.remove('flex');   // Убираем flex-отображение, чтобы элемент не занимал место
  }, 4000);
}

/**
 * startPolling — заглушка для будущего автообновления расписания.
 *
 * Автообновление через setInterval отключено намеренно: частые API-запросы
 * к Битрикс24 расходуют лимиты REST API и нагружают портал.
 * Расписание обновляется тремя более безопасными способами:
 *   1. При загрузке страницы — через initCalendar() выше.
 *   2. После бронирования — автоматически в calendar.js.
 *   3. Вручную кнопкой «Обновить расписание» в index.php.
 *
 * Если потребуется автообновление — реализовать здесь с экспоненциальным
 * backoff и проверкой видимости вкладки (document.visibilityState).
 */
function startPolling() { /* no-op — см. комментарий выше */ }

// Re-export через window — другие модули (form-submit, slots, booking) ещё
// обращаются к showError/showSuccess как к глобалам.
window.showError = showError;
window.showSuccess = showSuccess;
window.startPolling = startPolling;
