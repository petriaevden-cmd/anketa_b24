/**
 * calendar-render.js — рендер расписания в DOM и точка входа initCalendar.
 *
 * Содержит initCalendar() (точка входа из app.js) и renderTable() (главный
 * рендер таблицы расписания). Внутри renderTable использует selectSlot из
 * booking.js — поэтому импортирует его.
 *
 * Зависит от slots.js (state, fmtHour, fmtDate, loadAllSlots, ...),
 * booking.js (selectSlot, _highlightSelectedSlot, CONSULTATION_CHANNELS),
 * form-render.js (escHtml).
 */

import {
  loadMpCalendarsFromPortal, nextWorkday, shiftDay,
  fmtHour, fmtDate, buildFreeSlots,
  loadAllSlots, collectAllHours,
  _setCurrentDay, _setAutoJumpCount, _setMpCalendars,
  _currentDay, _clientUtc, _busyCache, _autoJumpCount, MAX_AUTO_JUMP, MP_CALENDARS
} from './slots.js';
import { selectSlot, _highlightSelectedSlot } from './booking.js';
import { escHtml } from './form-render.js';

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 4: ИНИЦИАЛИЗАЦИЯ КАЛЕНДАРЯ
// ══════════════════════════════════════════════════════════════════════════════

/**
 * initCalendar() — точка входа, async. Вызывается один раз из app.js после
 * загрузки страницы и инициализации BX24.
 *
 * Порядок действий:
 *   1. Загружаем MP_CALENDARS из портала через loadMpCalendarsFromPortal
 *      (11 параллельных calendar.section.get). v3-отличие: словарь строится
 *      из реальных данных Bitrix24, а не из хардкода mp-config.js.
 *   2. Находим ближайший рабочий день от сегодня (nextWorkday) — учитывая
 *      порог «минимум 3 МП работают», чтобы расписание не прыгало на
 *      воскресенье ради единственного дежурного.
 *   3. Навешиваем обработчики на кнопки навигации «←» и «→».
 *   4. Загружаем занятость для найденного дня (loadAllSlots).
 *
 * ВАЖНО: к моменту вызова initCalendar() функция setClientCity() уже должна быть
 * вызвана с флагом silent=true (это делает app.js), чтобы _clientUtc был установлен
 * до первой загрузки данных — иначе слоты отфильтруются без учёта TZ клиента.
 */
export async function initCalendar() {
  // Строим MP_CALENDARS из реальных данных Bitrix24 (v3: server-loaded вместо
  // хардкода). Делаем это один раз на всю сессию — структура календарей
  // не меняется во время работы анкеты.
  const calendars = await loadMpCalendarsFromPortal();
  _setMpCalendars(calendars);

  // Определяем стартовый день: ближайший день, когда работает не меньше
  // APP_CONFIG.minMpPerDay (по умолчанию 3) МП.
  _setCurrentDay(nextWorkday(new Date()));

  // Получаем ссылки на кнопки навигации по дням.
  const btnPrev = document.getElementById('btn-day-prev'); // кнопка «← предыдущий день»
  const btnNext = document.getElementById('btn-day-next'); // кнопка «→ следующий день»

  // Навешиваем обработчики только если кнопки реально есть в DOM
  // (защита от ошибки при неполной HTML-разметке).
  if (btnPrev) btnPrev.addEventListener('click', function () { shiftDay(-1); }); // -1 = назад
  if (btnNext) btnNext.addEventListener('click', function () { shiftDay(+1); }); // +1 = вперёд

  // loadAllSlots вызывается здесь один раз. Второй вызов из setClientCity()
  // предотвращается флагом silent=true в app.js.
  loadAllSlots();
}


// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 11: РЕНДЕРИНГ ТАБЛИЦЫ РАСПИСАНИЯ
// ══════════════════════════════════════════════════════════════════════════════

// _onRenderComplete — колбэк, вызываемый после завершения рендера таблицы.
// Используется внешним кодом (app.js) для разблокировки кнопки «Обновить расписание».
// Баг 6 fix: устанавливается снаружи перед вызовом loadAllSlots(), сбрасывается после вызова.
export let _onRenderComplete = null;

/**
 * setOnRenderComplete(fn) — единственный способ установить колбэк _onRenderComplete
 * из-за пределов модуля.
 *
 * ЗАЧЕМ: ES-модули запрещают прямое присвоение export let переменной снаружи —
 * инлайн-скрипт index.php не может написать `_onRenderComplete = fn` и получить
 * эффект внутри модуля. Сеттер-функция решает эту проблему: она живёт внутри
 * модуля и имеет прямой доступ к переменной.
 *
 * Пробрасывается в window через app.js: window.setOnRenderComplete = setOnRenderComplete.
 *
 * @param {Function|null} fn — колбэк или null для сброса.
 */
export function setOnRenderComplete(fn) {
  _onRenderComplete = fn;
}

/**
 * renderTable() — строит HTML-таблицу «МП × часовые слоты» и вставляет её в DOM.
 *
 * ПОШАГОВАЯ ЛОГИКА:
 *   1. Для каждого МП вычисляем свободные слоты через buildFreeSlots().
 *   2. Если суммарное число свободных слотов < minSlots И счётчик автопереходов
 *      не превышен → сдвигаемся на следующий рабочий день и повторяем loadAllSlots().
 *   3. Если свободных слотов нет совсем (после исчерпания автопереходов) →
 *      показываем сообщение об отсутствии слотов.
 *   4. Строим THEAD: строка-подпись (поясняет логику двух времён) + строка заголовков колонок.
 *   5. Строим TBODY: по одной строке на каждого МП.
 *      В каждой ячейке: кнопка (свободный слот) / неактивная кнопка (занято) / серая полоса (вне графика).
 *   6. Добавляем легенду под таблицей.
 *   7. Вызываем _onRenderComplete (если установлен).
 */
export function renderTable() {
  // Получаем контейнер таблицы расписания.
  const panel = document.getElementById('slots-panel');
  if (!panel) return; // Нет контейнера — рендеринг невозможен.

  const slotsMap = {}; // Здесь будем хранить свободные слоты по calId.
  let totalFree  = 0;  // Общее число свободных слотов по всем МП.

  // Вычисляем свободные слоты для каждого МП.
  Object.keys(MP_CALENDARS || {}).forEach(function (calId) {
    const mp    = MP_CALENDARS[calId];                   // Конфиг МП.
    const busy  = _busyCache[calId] || [];               // Занятые события (из кеша).
    const slots = buildFreeSlots(mp, _currentDay, busy); // Список свободных слотов.
    slotsMap[calId] = slots;
    totalFree += slots.length; // Считаем общее число свободных слотов.
  });

  // Читаем минимальный порог слотов для показа таблицы (по умолчанию 3).
  const cfg      = window.APP_CONFIG || {};
  const minSlots = cfg.minSlots || 3;

  // Автопереход: если слотов мало и лимит автопереходов не исчерпан →
  // переходим на следующий рабочий день и перезапускаем загрузку.
  if (totalFree < minSlots && _autoJumpCount < MAX_AUTO_JUMP) {
    // Фиксируем ещё один автопереход. Используем сеттер из slots.js,
    // потому что импортированный _autoJumpCount — иммутабельная привязка ES-модуля,
    // прямой инкремент даёт TypeError: Assignment to constant variable.
    _setAutoJumpCount(_autoJumpCount + 1);
    // eslint-disable-next-line no-console
    console.info(`[calendar-render] Автопереход #${_autoJumpCount + 1}: на ${_currentDay.toDateString()} свободных слотов ${totalFree} < ${minSlots}`);
    const nextDay = new Date(_currentDay);
    nextDay.setDate(nextDay.getDate() + 1); // Сдвигаемся на 1 день вперёд.
    _setCurrentDay(nextWorkday(nextDay));      // Находим ближайший рабочий день от nextDay.
    // Обновляем дату в заголовке (чтобы пользователь видел изменение).
    const dateEl = document.getElementById('schedule-date');
    if (dateEl) dateEl.textContent = fmtDate(_currentDay);
    loadAllSlots(); // Запускаем загрузку для нового дня.
    return;         // Прерываем текущий рендер — он будет вызван заново.
  }
  // Сбрасываем счётчик после завершения серии автопереходов.
  _setAutoJumpCount(0);

  // Финальное обновление заголовка с датой (после возможных автопереходов).
  const dateEl = document.getElementById('schedule-date');
  if (dateEl) dateEl.textContent = fmtDate(_currentDay);

  // Если слотов нет совсем — показываем информационное сообщение.
  if (totalFree === 0) {
    panel.innerHTML =
      '<p class="text-xs text-gray-400 text-center py-8">' +
      `Нет свободных слотов в ближайшие ${MAX_AUTO_JUMP} рабочих дней</p>`;
    return;
  }

  // Собираем отсортированный список уникальных UTC-моментов для заголовков колонок.
  const allHours    = collectAllHours(slotsMap);
  // Флаг: известен ли TZ клиента (влияет на цвет заголовков и подсказки).
  const hasClientTz = _clientUtc !== null;

  // Создаём обёртку с горизонтальной прокруткой (для широких таблиц на мобильных).
  const wrap = document.createElement('div');
  wrap.className = 'overflow-x-auto';

  // Создаём элемент таблицы.
  const table = document.createElement('table');
  table.className = 'w-full text-xs border-collapse';

  // ── THEAD: заголовочная часть таблицы ────────────────────────────────────

  const thead = document.createElement('thead');

  // Строка-подпись: объясняет пользователю, чьё время показано в заголовке (клиента)
  // и чьё — на кнопках (МП).
  const trCaption = document.createElement('tr');
  const thCaption = document.createElement('th');
  // Colspan = все колонки слотов + 1 (колонка «МП») = занимает всю ширину.
  thCaption.colSpan = allHours.length + 1;
  thCaption.className = 'px-3 pt-2 pb-1 text-left border-b border-gray-100 bg-gray-50';
  // Если TZ клиента известен — показываем детальное пояснение с цветовой кодировкой.
  // Иначе — упрощённое пояснение без цвета.
  thCaption.innerHTML = hasClientTz
    ? '<span class="text-[11px] text-gray-500">' +
      '<span class="inline-block w-2.5 h-2.5 rounded-sm bg-blue-100 border border-blue-300 align-middle mr-1"></span>' +
      `Заголовок колонки — <strong class="text-blue-600">время клиента</strong> (UTC+${_clientUtc})` +
      '&ensp;·&ensp;' +
      '<span class="inline-block w-2.5 h-2.5 rounded-sm bg-green-50 border border-green-300 align-middle mr-1"></span>' +
      'Кнопка в строке — <strong class="text-green-700">время МП</strong>' +
      '</span>'
    : '<span class="text-[11px] text-gray-400">Заголовок колонки — UTC · Кнопка в строке — время МП</span>';
  trCaption.appendChild(thCaption);
  thead.appendChild(trCaption);

  // Строка заголовков колонок (угловая ячейка «МП» + временны́е метки).
  const trHead = document.createElement('tr');

  // Угловая ячейка «МП» — sticky: остаётся видимой при горизонтальной прокрутке.
  const thCorner = document.createElement('th');
  thCorner.className = 'sticky left-0 z-10 bg-gray-50 text-left py-2 px-3 font-semibold text-gray-600 border-b border-r border-gray-200 whitespace-nowrap min-w-[64px]';
  thCorner.textContent = 'МП';
  trHead.appendChild(thCorner);

  // Заголовочные ячейки для каждого временно́го слота.
  allHours.forEach(function (col) {
    const th = document.createElement('th');
    // Синий фон для заголовков — визуально отличает «время клиента» от «времени МП» в кнопках.
    th.className = 'py-2 px-2 font-semibold border-b border-gray-200 text-center whitespace-nowrap min-w-[72px] bg-blue-50';
    // Если TZ клиента известен — выделяем метку синим шрифтом; иначе — серым.
    th.innerHTML = hasClientTz
      ? `<span class="font-mono text-blue-700">${escHtml(col.label)}</span>`
      : `<span class="font-mono text-gray-600">${escHtml(col.label)}</span>`;
    trHead.appendChild(th);
  });

  thead.appendChild(trHead);
  table.appendChild(thead);

  // ── TBODY: строки по каждому МП ──────────────────────────────────────────

  const tbody = document.createElement('tbody');

  // Для каждого МП создаём строку таблицы.
  Object.keys(MP_CALENDARS || {}).forEach(function (calId, rowIdx) {
    const mp    = MP_CALENDARS[calId]; // Конфиг МП.
    const slots = slotsMap[calId] || []; // Его свободные слоты.

    // Создаём быстрый lookup: utcMs → объект слота (для O(1) поиска при рендере ячейки).
    const slotsByUtc = {};
    slots.forEach(function (s) { slotsByUtc[s.utcMs] = s; });

    const tr = document.createElement('tr');
    // Чередуем фон строк для читаемости (зебра-полосатость).
    tr.className = (rowIdx % 2 === 0) ? 'bg-white' : 'bg-gray-50/50';

    // Ячейка с названием МП (короткое, без имени сотрудника).
    // sticky left-0: не прокручивается по горизонтали вместе с таблицей.
    const tdMp = document.createElement('td');
    tdMp.className = `sticky left-0 z-10 py-2 px-3 border-b border-r border-gray-200 whitespace-nowrap font-medium text-gray-700 ${ 
      (rowIdx % 2 === 0) ? 'bg-white' : 'bg-gray-50'}`;
    // Показываем только короткое название: "МП 42" (без имени сотрудника — конфиденциальность).
    tdMp.textContent = mp.short;
    tr.appendChild(tdMp);

    // Для каждой колонки (UTC-момента) создаём ячейку.
    allHours.forEach(function (col) {
      const td = document.createElement('td');
      td.className = 'py-1.5 px-1.5 border-b border-gray-100 text-center';

      // Баг 1 fix: col.utcMs — реальный UTC-момент, ищем напрямую без пересчёта.
      // Ранее была ошибка: к col.utcMs прибавлялось смещение МП, что давало неверный ключ.
      const slot = slotsByUtc[col.utcMs];

      if (slot) {
        // ── СЛОТ СВОБОДЕН: показываем кнопку бронирования ───────────────

        const btn = document.createElement('button');
        btn.type = 'button';
        // data-атрибуты нужны для _highlightSelectedSlot() — поиск кнопки по CSS-селектору.
        btn.dataset.calId  = calId;
        btn.dataset.utcMs  = slot.utcMs;
        btn.className =
          'slot-btn w-full rounded-md bg-green-50 border border-green-200 text-green-700 ' +
          'text-[11px] font-medium px-1.5 py-1 hover:bg-green-100 hover:text-gray-900 hover:border-green-400 ' +
          'transition-colors whitespace-nowrap tabular-nums';
        // Текст кнопки — время МП (не клиента), чтобы МП понял, когда ему работать.
        const mpTime = fmtHour(slot.utcMs, mp.utc);
        btn.textContent = mpTime;
        // Tooltip: показывает оба времени — МП и клиента (если TZ клиента известен).
        btn.title = hasClientTz
          ? `Время МП: ${mpTime} (UTC+${mp.utc})\nВремя клиента: ${fmtHour(slot.utcMs, _clientUtc)} (UTC+${_clientUtc})`
          : `Записать на ${mpTime} (UTC+${mp.utc})`;
        // При клике: сначала выделяем кнопку визуально, затем показываем форму подтверждения.
        btn.addEventListener('click', function () {
          _highlightSelectedSlot(calId, slot.utcMs); // Подсветка выбранной кнопки.
          selectSlot(calId, slot);                    // Показ панели бронирования.
        });
        td.appendChild(btn);

      } else {
        // ── СЛОТ НЕ СВОБОДЕН: показываем индикатор ───────────────────────

        // Определяем причину: занят (в рабочее время) или вне рабочего графика МП.
        const inWorkHours = (function () {
          // Баг 1 fix: col.utcMs — реальный UTC, прибавляем смещение МП для получения локального часа.
          const slotLocalH = new Date(col.utcMs + mp.utc * 3600000).getUTCHours();
          // Проверяем, попадает ли этот час в рабочий диапазон МП.
          return slotLocalH >= mp.from && slotLocalH < mp.to;
        }());

        if (inWorkHours) {
          // Занято в рабочее время — неактивная кнопка с бледным видом.
          // disabled запрещает клик, курсор-not-allowed даёт визуальный сигнал.
          const btn = document.createElement('button');
          btn.type     = 'button';
          btn.disabled = true;
          btn.className =
            'w-full rounded-md bg-gray-100 border border-gray-200 text-gray-400 ' +
            'text-[11px] font-normal px-1.5 py-1 cursor-not-allowed ' +
            'whitespace-nowrap tabular-nums opacity-60';
          btn.textContent = fmtHour(col.utcMs, mp.utc);
          btn.title       = 'Занято';
          td.appendChild(btn);
        } else {
          // Серая полоса — слот вне рабочего графика этого МП.
          const span = document.createElement('span');
          span.className = 'inline-block w-4 h-1 rounded bg-gray-100 align-middle';
          span.title     = 'Вне рабочего времени';
          td.appendChild(span);
        }
      }

      tr.appendChild(td); // Добавляем ячейку в строку.
    });

    tbody.appendChild(tr); // Добавляем строку МП в тело таблицы.
  });

  table.appendChild(tbody);
  wrap.appendChild(table);

  // Заменяем содержимое панели новой таблицей.
  panel.innerHTML = '';
  panel.appendChild(wrap);

  // Легенда под таблицей: объясняет значение цветовых индикаторов.
  const legend = document.createElement('div');
  legend.className = 'flex items-center gap-4 mt-3 px-1';
  legend.innerHTML =
    '<span class="flex items-center gap-1.5 text-[11px] text-gray-500">' +
    '<span class="inline-block w-4 h-4 rounded bg-green-50 border border-green-200"></span>Свободно</span>' +
    '<span class="flex items-center gap-1.5 text-[11px] text-gray-500">' +
    '<span class="inline-block w-4 h-4 rounded bg-gray-100 border border-gray-200 opacity-60"></span>Занято</span>' +
    '<span class="flex items-center gap-1.5 text-[11px] text-gray-500">' +
    '<span class="inline-block w-4 h-1 rounded bg-gray-100 border border-gray-200"></span>Вне графика</span>';
  panel.appendChild(legend);

  // Баг 6 fix: уведомляем внешний код о завершении рендера таблицы.
  // Сбрасываем колбэк после вызова, чтобы он не сработал повторно.
  if (typeof _onRenderComplete === 'function') {
    _onRenderComplete();
    _onRenderComplete = null;
  }
}
