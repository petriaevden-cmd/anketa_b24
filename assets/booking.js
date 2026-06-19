/**
 * booking.js — бронирование слота: запуск БП и таймлайн-комментарий.
 *
 * Содержит CONSULTATION_CHANNELS, selectSlot(), bookSlot(),
 * notifyMpByCalId(), _highlightSelectedSlot().
 *
 * Зависит от slots.js (state: _currentDay, _clientUtc, _bookingInProgress,
 * MP_CALENDARS, fmtHour, fmtBpDateTime, loadAllSlots),
 * form-render.js (escHtml), AppState (window.AppState).
 */

import {
  fmtHour, fmtBpDateTime, loadAllSlots, setHiddenField,
  _setBookingInProgress, _setAutoJumpCount,
  _bookingInProgress, _clientUtc, MP_CALENDARS
} from './slots.js';
import { escHtml } from './form-render.js';
import { AppState } from './app-state.js';
// Прямые импорты вместо typeof-проверок: в module scope обращение к необъявленному
// идентификатору даёт ReferenceError, а не undefined.
import { updateTargetStatusWidget } from './form-init.js';
import { collectFormData } from './form-submit.js';

// showError живёт в app.js (точка входа) и пока экспортируется через window.* —
// после полной модуляризации app.js его можно будет импортировать напрямую.
const showError = (msg) => window.showError && window.showError(msg);

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 12: ОПЦИИ КАНАЛА КОНСУЛЬТАЦИИ
// ══════════════════════════════════════════════════════════════════════════════

/**
 * CONSULTATION_CHANNELS — список доступных каналов для проведения консультации.
 *
 * ЗАЧЕМ: при бронировании встречи клиент выбирает, как именно пройдёт консультация.
 * Выбранный канал передаётся в параметре ConsultationChannel бизнес-процесса
 * «Назначить встречу» и сохраняется в лиде, чтобы МП знал, как связаться с клиентом.
 *
 * Формат каждого элемента:
 *   { value: строка для БП/БД, label: отображаемый текст в select-е }
 */
// Значения — enum-ID вариантов поля UF_CRM_1755609681 (прод). БП «Назначить
// встречу» (TEMPLATE_ID=40) пишет ConsultationChannel в это enumeration-поле,
// поэтому передаём именно ID, а не текст (текстовые «Звонок»/«Яндекс Телемост»
// в поле больше не существуют → БП записал бы пусто/мусор). Список синхронизирован
// с OPTS_CHANNEL в form-render.js.
export const CONSULTATION_CHANNELS = [
  { value: '4280', label: 'WhatsApp' },        // enum-ID 4280
  { value: '4281', label: 'Telegram' },        // enum-ID 4281
  { value: '4340', label: 'Max (мессенджер)' },// enum-ID 4340
  { value: '5424', label: 'SMS' },             // enum-ID 5424
  { value: '5442', label: 'Не отправлять' }    // enum-ID 5442
];

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 13: ВЫБОР СЛОТА — ПОКАЗ ПАНЕЛИ ПОДТВЕРЖДЕНИЯ
// ══════════════════════════════════════════════════════════════════════════════

/**
 * selectSlot(calId, slot) — показывает панель подтверждения бронирования
 * после того, как пользователь кликнул на свободный слот.
 *
 * ЧТО ОТОБРАЖАЕТ:
 *   - Короткое имя МП.
 *   - Время МП в его часовом поясе.
 *   - Время клиента (если TZ известен).
 *   - Select «Канал консультации» (Звонок / WhatsApp / Telegram / Яндекс Телемост).
 *   - Кнопку «Подтвердить запись».
 *
 * ТАКЖЕ записывает в скрытые поля формы calId и UTC-время слота,
 * чтобы при submit формы (если таковой есть) данные бронирования не потерялись.
 *
 * @param {string} calId — идентификатор календаря МП, например "MP42Vstrechi".
 * @param {object} slot  — объект { utcMs, endUtcMs, mpUtc }.
 */
export function selectSlot(calId, slot) {
  // Получаем конфиг МП из словаря (или пустой объект при отсутствии).
  const mp = (MP_CALENDARS || {})[calId] || {};
  const bookingBody = document.getElementById('booking-body'); // Панель с деталями бронирования.

  if (bookingBody) {
    // Формируем список опций для select «Канал консультации».
    const channelOpts = CONSULTATION_CHANNELS.map(function (ch) {
      // escHtml() экранирует спецсимволы HTML — защита от XSS.
      return `<option value="${escHtml(ch.value)}">${escHtml(ch.label)}</option>`;
    }).join('');

    // Вставляем HTML-разметку панели бронирования. Оформлена карточкой в стиле
    // основной анкеты: bg-white, border-gray-200, rounded-lg, shadow-sm.
    bookingBody.innerHTML =
      '<div class="bg-white border border-gray-200 rounded-lg shadow-sm p-4 space-y-3">' +
      // Заголовок карточки.
      '<div class="flex items-center gap-2 text-sm font-semibold text-gray-900">' +
        '<span class="w-5 h-5 rounded bg-blue-50 flex items-center justify-center text-blue-500">' +
          '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></span>' +
        'Подтверждение записи</div>' +
      // Детали записи (МП / время).
      '<div class="space-y-1">' +
        `<div class="flex justify-between text-xs"><span class="text-gray-500">МП</span><span class="font-medium text-gray-800">${escHtml(mp.short)}</span></div>` +
        `<div class="flex justify-between text-xs"><span class="text-gray-500">Время МП</span><span class="font-mono font-medium text-gray-800">${
          escHtml(fmtHour(slot.utcMs, mp.utc))} UTC+${mp.utc}</span></div>${
          _clientUtc !== null
            ? `<div class="flex justify-between text-xs"><span class="text-gray-500">Время клиента</span><span class="font-mono font-medium text-blue-600">${
              escHtml(fmtHour(slot.utcMs, _clientUtc))} UTC+${_clientUtc}</span></div>`
            : ''
        }</div>` +
      // Селект «Канал консультации» — стиль design-system (text-sm, p-2).
      '<div class="flex flex-col gap-1">' +
        '<label for="bp-channel" class="block text-sm font-medium text-gray-700">Канал консультации</label>' +
        '<select id="bp-channel" class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg ' +
          `focus:ring-blue-500 focus:border-blue-500 block w-full p-2">${
            channelOpts  // Список опций канала.
          }</select>` +
      '</div>' +
      // Кнопка подтверждения бронирования (зелёный CTA, размер как primary).
      '<button type="button" id="btn-book-confirm" ' +
        'class="w-full justify-center inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 focus:ring-2 focus:ring-green-300 transition-colors">' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>' +
        'Подтвердить запись</button>' +
      '</div>';

    // Навешиваем обработчик на кнопку «Подтвердить запись».
    const confirmBtn = document.getElementById('btn-book-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        // Защита от двойного клика: если бронирование уже идёт — игнорируем.
        if (_bookingInProgress) return;
        _setBookingInProgress(true);    // Ставим флаг блокировки.
        confirmBtn.disabled = true;   // Блокируем кнопку визуально.
        confirmBtn.textContent = 'Запись...'; // Показываем состояние ожидания.
        bookSlot(calId, slot);         // Запускаем бронирование.
      });
    }
  }

  // Сохраняем данные о выбранном МП и времени в hidden-поля формы. Эти поля
  // потом читает collectFormData() и передаёт в маппер field-mapper.js.
  // ISO с явным офсетом — формат, который Битрикс принимает в datetime-полях.
  const mpUtc      = (typeof mp.utc === 'number') ? mp.utc : 0;
  const clientUtc  = (_clientUtc !== null) ? _clientUtc : mpUtc;
  // В hidden-поле f-bookedManagerCalId пишем числовой enum-ID варианта
  // UF_CRM_1747120414 («Менеджер встречи»). Маппер пробрасывает его в лид
  // как есть. Если у МП по какой-то причине enumId не задан — пишем пусто,
  // чтобы маппер не отправил мусорное значение.
  setHiddenField('f-bookedManagerCalId', mp.enumId != null ? String(mp.enumId) : '');
  setHiddenField('f-bookedTimeMP',     fmtIsoWithOffset(slot.utcMs, mpUtc));
  setHiddenField('f-bookedTimeClient', fmtIsoWithOffset(slot.utcMs, clientUtc));
}

// fmtIsoWithOffset(utcMs, offsetH) — формирует строку формата ISO с явным
// часовым поясом: "YYYY-MM-DDTHH:MM:SS+HH:MM". Битрикс принимает её в
// datetime-полях. offsetH — целое число часов (например, 3 = МСК, 4 = Самара).
function fmtIsoWithOffset(utcMs, offsetH) {
  const local = new Date(utcMs + offsetH * 3600000);
  const p = function (n) { return String(n).padStart(2, '0'); };
  const sign  = offsetH >= 0 ? '+' : '-';
  const abs   = Math.abs(offsetH);
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}T${
    p(local.getUTCHours())}:${p(local.getUTCMinutes())}:00${sign}${p(abs)}:00`;
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 14: БРОНИРОВАНИЕ — ЗАПУСК БИЗНЕС-ПРОЦЕССА «НАЗНАЧИТЬ ВСТРЕЧУ»
// ══════════════════════════════════════════════════════════════════════════════

/**
 * bookSlot(calId, slot) — выполняет фактическое бронирование встречи:
 *   1. Запускает бизнес-процесс Bitrix24 через bizproc.workflow.start
 *      (БП сам создаёт событие в календаре МП и пишет его ID в
 *      UF_CALENDAR_EVENTS лида).
 *   2. Пишет комментарий в таймлайн лида (notifyMpByCalId).
 *   3. Обновляет таблицу расписания (слот становится занятым).
 *   4. Показывает подтверждение пользователю.
 *
 * ПАРАМЕТРЫ БИЗНЕС-ПРОЦЕССА (5 полей, все обязательные):
 *   - DateTime        — дата/время встречи в локальном времени МП, ISO 8601 (например "2026-05-13T14:00:00+03:00").
 *   - DateTimeClient  — та же встреча в локальном времени клиента в ISO (или времени МП, если TZ клиента неизвестен).
 *   - CalendarMenager — числовой enumId варианта поля UF_CRM_1747120414 «Менеджер встречи» (например 2103 = МП5, 5092 = МП7).
 *   - ConsultationChannel — enumId варианта поля UF_CRM_1755609681 (4280=WhatsApp, 4281=Telegram, 4340=Max (мессенджер), 5424=SMS, 5442=Не отправлять).
 *   - CelNeCel        — enumId варианта поля UF_CRM_1649136704 (289=Целевой, 290=Нецелевой, 291=Не определено).
 *
 * @param {string} calId — идентификатор календаря МП.
 * @param {object} slot  — объект { utcMs, endUtcMs, mpUtc }.
 */
export function bookSlot(calId, slot) {
  // leadId читаем явно из AppState (задача 5). Раньше это была неявная
  // глобальная зависимость от app.js — теперь доступ контролируется одним
  // источником, и можно подписаться на изменения через AppState.on('leadId', ...).
  const leadId = AppState.get('leadId');
  if (!leadId) {
    _setBookingInProgress(false); // Снимаем блокировку — действие не выполнено.
    return;
  }

  // ── Статус «Целевой / Нецелевой» ──────────────────────────────
  //
  // Рассчитываем статус перед запуском БП. Предпочитаем вызвать
  // updateTargetStatusWidget() из form.js (он же запишет результат
  // в window.__targetStatus). Если функция недоступна (легаси-сборка) —
  // пытаемся вызвать TargetStatus.evaluate напрямую. Если и этого нет —
  // принимаем статус 291 «Не определено» как fallback.
  // updateTargetStatusWidget() из form-init.js пишет результат в window.__targetStatus.
  // Если по какой-то причине он не сработал — пробуем TargetStatus.evaluate напрямую.
  try {
    updateTargetStatusWidget();
  } catch (e) {
    if (typeof window.TargetStatus !== 'undefined') {
      window.__targetStatus = window.TargetStatus.evaluate(collectFormData());
    }
  }
  const targetStatus = window.__targetStatus || {
    id: 291, label: 'Не определено', reasons: ['Модуль оценки не загружен']
  };

  // Мягкое предупреждение при статусе 291 «Не определено»:
  // разрешаем бронирование после явного подтверждения менеджера.
  // (Решение пользователя в плане: запрет мягкий, не блокирующий.)
  if (targetStatus.id === 291) {
    const ok = confirm(
      '«Целевой/Нецелевой» не определён. Записать всё равно?'
    );
    if (!ok) {
      // Отмена — разблокируем кнопку и выходим.
      _setBookingInProgress(false);
      const cb = document.getElementById('btn-book-confirm');
      if (cb) {
        cb.disabled = false;
        cb.innerHTML =
          '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>' +
          'Подтвердить запись';
      }
      return;
    }
  }

  // Читаем ФИО клиента из поля формы (используется в таймлайн-комментарии).
  const fio = (document.getElementById('f-fio') || {}).value || 'Клиент';
  // Получаем конфиг МП из словаря.
  const mp  = (MP_CALENDARS || {})[calId] || {};
  // Глобальный конфиг приложения.
  const cfg = window.APP_CONFIG || {};

  // Читаем выбранный канал консультации из select-а. value — enum-ID
  // (UF_CRM_1755609681); channelLabel — человекочитаемая подпись для таймлайна.
  const channelEl = document.getElementById('bp-channel');
  const channel   = channelEl ? channelEl.value : (CONSULTATION_CHANNELS[0] && CONSULTATION_CHANNELS[0].value) || '';
  const channelLabel = (CONSULTATION_CHANNELS.find(function (c) { return c.value === channel; }) || {}).label || channel;

  // Форматируем время встречи для МП: перевод UTC → локальное время МП в ISO 8601.
  // Пример: UTC 11:00, МП в UTC+3 → "2026-05-13T14:00:00+03:00".
  // ИМЕННО ISO: БП 40 не парсит русский dd.mm.YYYY и записывает epoch=0 в поля лида.
  const dateTimeMp = fmtBpDateTime(slot.utcMs, mp.utc);

  // Форматируем время для клиента: если TZ клиента известен — его время,
  // иначе используем время МП (чтобы поле не пустовало).
  const clientOffset    = (_clientUtc !== null) ? _clientUtc : mp.utc;
  const dateTimeClient  = fmtBpDateTime(slot.utcMs, clientOffset);

  // Для БП CalendarMenager ожидает строку "Менеджер N" (N=1..8) —
  // это option-ключи select-параметра шаблона БП #40, не enum-ID поля.
  // Для crm.lead.update используем mp.enumId (числовой enum-ID UF_CRM_1747120414).
  const bpCalendarMenager = (mp.number >= 1 && mp.number <= 8)
    ? `Менеджер ${mp.number}`
    : null;

  // Для БП ConsultationChannel ожидает текстовую метку ("WhatsApp", "Telegram" …) —
  // option-ключи select-параметра шаблона БП #40, не enum-ID поля.
  // channelLabel уже содержит нужный текст (совпадает с option-ключами БП).
  // Для crm.lead.update используем channel (enum-ID UF_CRM_1755609681).

  // Запускаем бизнес-процесс Bitrix24 «Назначить встречу» через REST API.
  // CelNeCel — internalselect, ссылается на UF_CRM_1649136704: передаём enum-ID.
  const bpParams = {
    'DateTime':            dateTimeMp,
    'DateTimeClient':      dateTimeClient,
    'CalendarMenager':     bpCalendarMenager,   // "Менеджер 1".."Менеджер 8"
    'ConsultationChannel': channelLabel,         // "WhatsApp", "Telegram" …
    'CelNeCel':            String(targetStatus.id)
  };
  // eslint-disable-next-line no-console
  console.info('[booking] bizproc.workflow.start →', {
    TEMPLATE_ID: cfg.bpTemplateId || 40,
    DOCUMENT_ID: ['crm', 'CCrmDocumentLead', `LEAD_${leadId}`],
    PARAMETERS: bpParams
  });
  BX24.callMethod('bizproc.workflow.start', {
    TEMPLATE_ID: cfg.bpTemplateId || 40,
    DOCUMENT_ID: ['crm', 'CCrmDocumentLead', `LEAD_${leadId}`],
    PARAMETERS: bpParams
  }, function (result) {
    // Снимаем флаг блокировки в любом случае (успех или ошибка).
    _setBookingInProgress(false);

    if (result.error()) {
      // eslint-disable-next-line no-console
      console.error('[booking] bizproc.workflow.start error:', result.error());
      showError(`Ошибка запуска БП: ${result.error()}`);
      const confirmBtn = document.getElementById('btn-book-confirm');
      if (confirmBtn) {
        confirmBtn.disabled = false; // Разблокируем кнопку.
        confirmBtn.innerHTML =
          '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>' +
          ' Повторить'; // Меняем текст кнопки на «Повторить».
      }
      return;
    }

    // Успешный запуск БП. UF_CALENDAR_EVENTS заполняет сам БП «Назначить
    // встречу» (TEMPLATE_ID=40): он создаёт событие в календаре менеджера и
    // пишет числовой ID события в это поле лида. Анкета здесь больше ничего
    // в лид не сохраняет — попытка записать workflow-ID (строку формата
    // "69fdcd7accc.12696764") приводила к 400 «Значение поля должно быть
    // целым числом».
    // eslint-disable-next-line no-console
    console.info('[booking] БП запущен, workflow ID:', result.data());

    // Записываем поля лида напрямую через enum-ID (не текстовые метки БП).
    // UF_CRM_1747120414 — «Менеджер встречи»   (mp.enumId, числовой enum)
    // UF_CRM_1755609681 — «Канал консультации» (channel, enum-ID: 4280/4281/…)
    // UF_CRM_1649136704 — «Целевой/Нецелевой» (enum-ID: 289/290/291)
    const crmFields = { UF_CRM_1755609681: String(channel), UF_CRM_1649136704: String(targetStatus.id) };
    if (mp.enumId != null) crmFields['UF_CRM_1747120414'] = String(mp.enumId);
    BX24.callMethod('crm.lead.update', {
      ID: leadId,
      FIELDS: crmFields
    }, function (upd) {
      if (upd.error()) {
        // eslint-disable-next-line no-console
        console.warn('[booking] crm.lead.update error:', upd.error());
      } else {
        // eslint-disable-next-line no-console
        console.info('[booking] Поля лида обновлены.');
      }
    });

    // Пишем информационный комментарий в таймлайн лида.
    // Передаём targetStatus — оценку «Целевой/Нецелевой» и список причин
    // для расширенного комментария по стандарту Нецелевой.
    notifyMpByCalId(calId, slot, fio, channelLabel, targetStatus);

    // БП «Назначить встречу» создаёт событие в календаре асинхронно.
    // Немедленный loadAllSlots() не увидит его и слот останется зелёным
    // у всех пользователей. Делаем два отложенных перезапроса:
    //   • через 4 с — накрывает быстрый БП;
    //   • через 12 с — страховка, если сервер под нагрузкой.
    _setAutoJumpCount(0);
    setTimeout(loadAllSlots, 4000);
    setTimeout(loadAllSlots, 12000);

    // Показываем пользователю подтверждение успешной записи.
    const statusEl = document.getElementById('booking-status');
    if (statusEl) {
      statusEl.className = 'mt-2 p-2 rounded-lg bg-green-50 border border-green-200 text-xs text-green-800 flex items-center gap-1.5';
      statusEl.innerHTML =
        '<svg class="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">' +
          '<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>' +
        `<span>Запись подтверждена: ${escHtml(mp.short)}, ${ 
          escHtml(fmtHour(slot.utcMs, mp.utc))} UTC+${mp.utc 
        }, канал: ${escHtml(channelLabel)}</span>`;
      statusEl.classList.remove('hidden'); // Делаем блок статуса видимым.
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 15: КОММЕНТАРИЙ В ТАЙМЛАЙН ЛИДА
// ══════════════════════════════════════════════════════════════════════════════
//
// Раньше здесь была функция saveBookingToLead(), которая писала workflow-ID
// в UF_CALENDAR_EVENTS лида. Это поле имеет тип Integer (хранит ID события
// календаря), а workflow-ID — строка вида "69fdcd7accc.12696764", поэтому
// crm.lead.update возвращал 400. Поле UF_CALENDAR_EVENTS теперь заполняет
// сам БП «Назначить встречу» (TEMPLATE_ID=40): он создаёт событие в
// календаре менеджера и пишет числовой ID этого события в лид.

/**
 * notifyMpByCalId(calId, slot, leadName, channel) — добавляет информационный
 * комментарий в таймлайн лида о выполненном бронировании.
 *
 * ЗАЧЕМ: менеджер, открывший лид в Bitrix24, сразу видит в таймлайне,
 * к какому МП, на какое время и через какой канал записан клиент.
 * Это дополняет уведомление от БП и служит документацией в истории лида.
 *
 * Пример текста комментария:
 *   «Запись к МП 42 на 14:00 UTC+3. Клиент: Иван Иванов. Канал: WhatsApp»
 *
 * @param {string} calId     — calId МП.
 * @param {object} slot      — объект слота { utcMs, ... }.
 * @param {string} leadName  — ФИО клиента из поля формы.
 * @param {string} channel   — выбранный канал консультации.
 */
export function notifyMpByCalId(calId, slot, leadName, channel, targetStatus) {
  // Получаем конфиг МП для формирования читабельного имени в комментарии.
  const mp = (MP_CALENDARS || {})[calId] || {};
  // Формируем базовый текст комментария: МП + время в его TZ + имя клиента + канал.
  let comment = `Запись к ${mp.short || calId} на ${ 
    fmtHour(slot.utcMs, mp.utc)} UTC+${mp.utc 
  }. Клиент: ${leadName 
  }${channel ? `. Канал: ${channel}` : ''}`; // Канал добавляем только если он указан.

  // Расширяем комментарий блоком «Целевой/Нецелевой КЦ». Это требование
  // «Стандарта НЕЦЕЛЕВОЙ встречи»: в истории лида видна итоговая оценка
  // и сработавшие причины. targetStatus приходит из evaluateTargetStatus().
  if (targetStatus && targetStatus.label) {
    comment += `\n\nЦелевой/Нецелевой КЦ: ${targetStatus.label.toUpperCase()}.`;
    if (targetStatus.reasons && targetStatus.reasons.length > 0) {
      // Перечисляем причины как пультовый список («•» работает в комментарии Bitrix24).
      comment += ` Причины:\n• ${targetStatus.reasons.join('\n• ')}`;
    }
  }

  // Добавляем комментарий в таймлайн через CRM REST API.
  const leadId = AppState.get('leadId');
  BX24.callMethod('crm.timeline.comment.add', {
    fields: {
      ENTITY_ID:   leadId,   // ID лида (получен из AppState — задача 5).
      ENTITY_TYPE: 'lead',   // Тип сущности.
      COMMENT:     comment   // Текст комментария.
    }
  }, function () {}); // Колбэк пустой — ошибки комментария некритичны.
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 17: ВИЗУАЛЬНОЕ ВЫДЕЛЕНИЕ ВЫБРАННОГО СЛОТА
// ══════════════════════════════════════════════════════════════════════════════

/**
 * _highlightSelectedSlot(calId, utcMs) — снимает выделение со всех кнопок-слотов
 * и применяет стиль «выбрано» к нажатой кнопке.
 *
 * ЗАЧЕМ: даёт пользователю визуальное подтверждение того, какой слот он выбрал,
 * прежде чем подтвердить бронирование. Выбранная кнопка становится синей.
 *
 * ПОРЯДОК ВЫЗОВА: вызывается ДО selectSlot() в обработчике клика кнопки.
 * Это важно, потому что selectSlot может изменить DOM панели booking-body,
 * но сама таблица слотов не перестраивается.
 *
 * @param {string} calId  — calId МП выбранного слота.
 * @param {number} utcMs  — UTC-момент выбранного слота.
 */
export function _highlightSelectedSlot(calId, utcMs) {
  const panel = document.getElementById('slots-panel'); // Контейнер таблицы.

  if (panel) {
    // Получаем все кнопки-слоты в таблице.
    const allBtns = panel.querySelectorAll('.slot-btn');
    for (let i = 0; i < allBtns.length; i++) {
      // Сначала снимаем все классы выделения со всех кнопок...
      allBtns[i].classList.remove(
        'slot-btn-selected',
        'bg-blue-600', 'border-blue-700', 'text-white', // Классы «выбранного» состояния.
        'bg-green-50', 'border-green-200', 'text-green-700' // Классы «свободного» состояния.
      );
      // ...и восстанавливаем базовый стиль «свободного» слота.
      allBtns[i].classList.add(
        'bg-green-50', 'border-green-200', 'text-green-700'
      );
    }
  }

  // Ищем именно нажатую кнопку по data-атрибутам calId и utcMs.
  // Атрибуты были проставлены при создании кнопки в renderTable().
  const selectedBtn = panel
    ? panel.querySelector(
      `.slot-btn[data-cal-id="${calId}"][data-utc-ms="${utcMs}"]`
    )
    : null;

  if (selectedBtn) {
    // Убираем зелёный стиль «свободного» состояния...
    selectedBtn.classList.remove(
      'bg-green-50', 'border-green-200', 'text-green-700'
    );
    // ...и применяем синий стиль «выбранного» состояния.
    selectedBtn.classList.add(
      'slot-btn-selected', 'bg-blue-600', 'border-blue-700', 'text-white'
    );
  }
}

