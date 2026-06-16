// =============================================================================
// assets/slots.js — построение расписания МП (v3)
// =============================================================================
//
// КАК РАБОТАЕТ РАСПИСАНИЕ В v3 (коротко)
// ────────────────────────────────────────────────────────────────────────────
//
//   1. На старте loadMpCalendarsFromPortal() делает 11 параллельных
//      calendar.section.get запросов с type=MP1Vstrechi..MP11Vstrechi.
//      Из ответа берёт реальный sectionId, имя и CAL_TYPE каждого календаря.
//      Рабочий график и часовой пояс берутся из MP_WORK_DEFAULTS (mp-config.js),
//      потому что в ответе calendar.section.get этих полей нет — мы это
//      проверили discovery-запросом.
//
//   2. На каждый рабочий день loadAllSlots() делает ещё 11 параллельных
//      calendar.event.get запросов с теми же type=MP[N]Vstrechi. Каждый
//      ответ — это уже занятость КОНКРЕТНОГО МП, и никакого парсинга
//      названий «| МП N» больше не нужно. События с DELETED='Y' и
//      ACCESSIBILITY='free' отфильтровываются — они не блокируют слот.
//
//   3. buildFreeSlots() пересекает рабочий график МП (в TZ МП) с его
//      занятостью и отдаёт список свободных слотов. TZ клиента на
//      доступность не влияет — только на отображение времени в заголовках.
//
// ЧТО УБРАНО ИЗ v2
// ────────────────────────────────────────────────────────────────────────────
//
//   • Хардкод 8 менеджеров в mp-config.js (см. mp-config.js v3).
//   • Парсинг названий событий регэкспом /\|\s*МП\s*(\d+)\s*$/ — он давал
//     ложные совпадения, когда исторический company_calendar #17
//     «МП1 - Сергей Ариков» и новый MP1Vstrechi (#20) пересекались.
//   • Запрос занятости у единственного техюзера U=137 — теперь у каждого
//     МП свой календарь, опрашиваем их напрямую.
//   • Генерация calId как `MP${bitrixUserId}Vstrechi` — давала
//     несуществующие идентификаторы. Теперь calId это реальный CAL_TYPE
//     календаря (MP1Vstrechi..MP11Vstrechi).
// =============================================================================

'use strict';

// renderTable вызывается из loadAllSlots по завершении запроса.
// Динамический import чтобы не было циркулярки на этапе модуль-инициализации
// (calendar-render.js сам импортирует часть утилит отсюда).
let _renderTableFn = null;
async function _getRenderTable() {
  if (!_renderTableFn) {
    const mod = await import('./calendar-render.js');
    _renderTableFn = mod.renderTable;
  }
  return _renderTableFn;
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 1: ЗАГРУЗКА КАЛЕНДАРЕЙ МП ИЗ ПОРТАЛА
// ══════════════════════════════════════════════════════════════════════════════

/**
 * loadMpCalendarsFromPortal() → Promise<{ MP1Vstrechi: {...}, ... }>
 *
 * Делает 11 параллельных calendar.section.get запросов и собирает словарь
 * MP_CALENDARS, который потом используется во всём расписании.
 *
 * Формат элемента словаря (ключ — CAL_TYPE, например "MP2Vstrechi"):
 *   {
 *     number:      2,                  // порядковый номер МП (1..11)
 *     calType:     "MP2Vstrechi",      // = ключ словаря, используется в bizproc-параметре
 *     sectionId:   "15",               // реальный ID секции календаря из Bitrix24
 *     name:        "МП2 - Виталий Прилепин", // как написано в Bitrix24
 *     label:       "МП2 - Виталий Прилепин", // для UI карточки бронирования
 *     short:       "МП 2",             // для столбца таблицы и таймлайн-комментария
 *     utc:         4,                  // utcOffset из MP_WORK_DEFAULTS
 *     from:        9,                  // часы начала рабочего дня (для совместимости со старым API)
 *     to:          17,                 // часы конца рабочего дня
 *     workStart:   "09:00",            // полное HH:MM (на будущее, для интеграции с workdays)
 *     workEnd:     "17:00",
 *     workDays:    [1,2,3,4,5],        // дни недели по getDay()
 *     slotMinutes: 60,
 *     enumId:      2100                // null если enum-вариант ещё не создан
 *   }
 *
 * Если какой-то calendar.section.get вернул ошибку или пустой массив —
 * этот МП просто не попадает в словарь. Это нормальный graceful degradation:
 * приложение продолжит работать с теми МП, что доступны.
 */
export async function loadMpCalendarsFromPortal() {
  // Список номеров МП берём из глобальной MP_NUMBERS (mp-config.js — обычный
  // <script>, не ES-модуль, поэтому константы там в window.*).
  const numbers = (typeof MP_NUMBERS !== 'undefined') ? MP_NUMBERS : [1,2,3,4,5,6,7,8,9,10,11];
  const enumMap = (typeof MP_BOOKING_ENUM_MAP !== 'undefined') ? MP_BOOKING_ENUM_MAP : {};
  const defaults = (typeof MP_WORK_DEFAULTS !== 'undefined') ? MP_WORK_DEFAULTS : {};

  // DEV и CRM используют одинаковые типы MP[N]Vstrechi, но разные ID секций.
  // Фоллбэк: если секция не нашлась по типу и окружение DEV и есть ID в MP_DEV_SECTION_IDS —
  // используем хардкодный ID как запасной вариант.
  const isDev = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.appEnv === 'dev');
  const devSectionIds = (typeof MP_DEV_SECTION_IDS !== 'undefined') ? MP_DEV_SECTION_IDS : {};

  const promises = numbers.map(function (n) {
    return new Promise(function (resolve) {
      BX24.callMethod('calendar.section.get', {
        type: `MP${n}Vstrechi`,
        ownerId: 0
      }, function (result) {
        if (result.error()) {
          // eslint-disable-next-line no-console
          console.warn(`[slots] calendar.section.get failed for MP${n}Vstrechi:`, result.error());
          return resolve(null);
        }

        const sections = result.data() || [];
        const wd = defaults[n] || {
          workStart: '09:00', workEnd: '18:00',
          workDays: [1,2,3,4,5], utcOffset: 3, slotMinutes: 60
        };
        const startH = parseInt(wd.workStart.split(':')[0], 10);
        const endH   = parseInt(wd.workEnd.split(':')[0], 10);
        const calType = `MP${n}Vstrechi`;

        if (Array.isArray(sections) && sections.length > 0) {
          // Секция нашлась по типу — берём реальные данные из портала.
          const sec = sections[0];
          resolve([calType, {
            number:      n,
            calType:     calType,
            sectionId:   sec.ID,
            name:        sec.NAME || `МП ${n}`,
            label:       sec.NAME || `МП ${n}`,
            short:       `МП ${n}`,
            utc:         wd.utcOffset,
            from:        startH,
            to:          endH,
            workStart:   wd.workStart,
            workEnd:     wd.workEnd,
            workDays:    wd.workDays,
            slotMinutes: wd.slotMinutes || 60,
            enumId:      (enumMap[n] != null) ? enumMap[n] : null
          }]);
        } else if (isDev && devSectionIds[n]) {
          // Секция не нашлась по типу, но есть хардкодный DEV-ID — используем его.
          // eslint-disable-next-line no-console
          console.info(`[slots] DEV фоллбэк: MP${n}Vstrechi не найдена по типу, беру sectionId=${devSectionIds[n]}`);
          resolve([calType, {
            number:      n,
            calType:     calType,
            sectionId:   String(devSectionIds[n]),
            name:        `МП ${n}`,
            label:       `МП ${n}`,
            short:       `МП ${n}`,
            utc:         wd.utcOffset,
            from:        startH,
            to:          endH,
            workStart:   wd.workStart,
            workEnd:     wd.workEnd,
            workDays:    wd.workDays,
            slotMinutes: wd.slotMinutes || 60,
            enumId:      (enumMap[n] != null) ? enumMap[n] : null
          }]);
        } else {
          resolve(null);
        }
      });
    });
  });

  const results = await Promise.all(promises);
  const dict = {};
  results.forEach(function (pair) {
    if (pair) dict[pair[0]] = pair[1];
  });

  // eslint-disable-next-line no-console
  console.info(`[slots] Загружено календарей МП из портала: ${Object.keys(dict).length}/${numbers.length}`);
  return dict;
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 2: TZ КЛИЕНТА (городской справочник)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * _getCityTz(cityName) — UTC-смещение города в часах или null.
 *
 * Делегирует в cities.js (getCityTZ / CITIES_TZ). Завёрнуто в helper, чтобы
 * остальной код не лез напрямую в глобалы.
 */
export function _getCityTz(cityName) {
  if (typeof getCityTZ === 'function') return getCityTZ(cityName);
  if (typeof CITIES_TZ !== 'undefined' && CITIES_TZ[cityName] !== undefined) return CITIES_TZ[cityName];
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 3: СОСТОЯНИЕ МОДУЛЯ
// ══════════════════════════════════════════════════════════════════════════════

// Текущий показываемый день (Date в локальном TZ браузера).
export let _currentDay    = null;
// UTC-смещение клиента в часах. null = TZ ещё не определён (город не выбран).
export let _clientUtc     = null;
// Счётчик автопереходов «следующий рабочий день», чтобы не зациклиться.
export let _autoJumpCount = 0;
export const MAX_AUTO_JUMP = 14;
// Кеш занятости: ключ = calType (MP[N]Vstrechi), значение = массив событий.
export let _busyCache   = {};
// Прогресс загрузки: сколько запросов завершилось / сколько всего.
export let _loadedCount = 0;
export let _totalToLoad = 0;
// Флаг «бронирование выполняется», защита от двойного клика.
export let _bookingInProgress = false;
// Словарь календарей МП. Заполняется один раз при initCalendar.
export let MP_CALENDARS = null;

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 4: УТИЛИТЫ ДАТ И НАВИГАЦИЯ
// ══════════════════════════════════════════════════════════════════════════════

/**
 * nextWorkday(d) — ближайший день, в который работает хотя бы 3 МП.
 *
 * Порог «3 МП» (а не «хотя бы 1») — чтобы расписание не прыгало на воскресенье
 * ради единственного дежурного. Можно переопределить через APP_CONFIG.minMpPerDay.
 */
export function nextWorkday(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  const cfg = (typeof window !== 'undefined' && window.APP_CONFIG) ? window.APP_CONFIG : {};
  const minMpPerDay = cfg.minMpPerDay || 3;
  for (let i = 0; i < 14; i++) {
    if (_countMpWorkingOn(dt) >= minMpPerDay) return dt;
    dt.setDate(dt.getDate() + 1);
  }
  // Fallback: если за 14 дней не нашли «хорошего» дня — возвращаем как есть.
  return dt;
}

/**
 * _countMpWorkingOn(date) — сколько активных МП работает в указанный день.
 */
function _countMpWorkingOn(date) {
  if (!MP_CALENDARS) return 0;
  const dow = date.getDay();
  let count = 0;
  Object.keys(MP_CALENDARS).forEach(function (calType) {
    const mp = MP_CALENDARS[calType];
    if (mp.workDays && mp.workDays.indexOf(dow) !== -1) count++;
  });
  return count;
}

/**
 * shiftDay(delta) — ручной сдвиг дня (кнопки «← / →»).
 *
 * При ручном сдвиге НЕ применяем порог minMpPerDay — пользователь явно хочет
 * посмотреть конкретный день, даже если там работает 0 МП.
 */
export function shiftDay(delta) {
  if (!_currentDay) return;
  const dt = new Date(_currentDay);
  dt.setDate(dt.getDate() + delta);
  _currentDay    = dt;
  _autoJumpCount = 0;
  loadAllSlots();
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 5: ФОРМАТИРОВАНИЕ ДАТ
// ══════════════════════════════════════════════════════════════════════════════

export function fmtHour(utcMs, offsetH) {
  const local = new Date(utcMs + offsetH * 3600000);
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

export function fmtDate(d) {
  return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function fmtBxUTC(utcMs) {
  const d = new Date(utcMs);
  const p = function (n) { return String(n).padStart(2, '0'); };
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00+00:00`;
}

/**
 * Форматирует время встречи в ISO-формат для параметров БП «Назначить встречу».
 *
 * ВАЖНО: БП 40 ожидает ИМЕННО ISO 8601 (`YYYY-MM-DDTHH:MM:SS+HH:MM`).
 * Раньше функция возвращала русский формат `dd.mm.YYYY HH:MM:SS` — БП не
 * мог его распарсить и записывал в поля лида epoch=0 (`1970-01-01T03:00:00+03:00`).
 * Проверено эмпирическим запуском БП 40 через REST: при ISO поля заполняются
 * корректно, при `dd.mm.YYYY` — ломаются.
 *
 * @param {number} utcMs   Абсолютный момент встречи в UTC, миллисекунды.
 * @param {number} offsetH Смещение целевой TZ от UTC в часах (например, +3 для МП, +5 для клиента в Самаре).
 * @returns {string}       Строка вида `2026-05-13T14:00:00+03:00`.
 */
export function fmtBpDateTime(utcMs, offsetH) {
  const d = new Date(utcMs + offsetH * 3600000);
  const p = function (n) { return String(n).padStart(2, '0'); };
  // Знак и величина смещения для суффикса ISO ("+03:00" / "-04:30").
  const sign = offsetH >= 0 ? '+' : '-';
  const abs = Math.abs(offsetH);
  const offH = Math.floor(abs);
  const offM = Math.round((abs - offH) * 60);
  const tz = `${sign}${p(offH)}:${p(offM)}`;
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00${tz}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 6: TZ КЛИЕНТА ИЗ ФОРМЫ
// ══════════════════════════════════════════════════════════════════════════════

export function getClientUtcFromForm() {
  const el = document.getElementById('f-client-city');
  if (!el || !el.value) return null;
  const tz = _getCityTz(el.value.trim());
  return (tz !== null && tz !== undefined) ? tz : null;
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 7: ЗАГРУЗКА ЗАНЯТОСТИ — ПО КАЖДОМУ КАЛЕНДАРЮ МП ОТДЕЛЬНО
// ══════════════════════════════════════════════════════════════════════════════

/**
 * loadAllSlots() — основная функция, запускается при смене дня / города / на старте.
 *
 * Алгоритм:
 *   1. Сбрасываем кеш занятости.
 *   2. Для каждого МП в MP_CALENDARS делаем calendar.event.get с его CAL_TYPE.
 *      Параметр type — это ключ нашего словаря (например, "MP2Vstrechi").
 *   3. Каждый ответ фильтруем: убираем DELETED='Y' и ACCESSIBILITY='free'
 *      (free — это «доступен», не блокирует слот).
 *   4. Когда все 11 ответов пришли — вызываем renderTable().
 */
export function loadAllSlots() {
  _clientUtc = getClientUtcFromForm();
  Object.keys(_busyCache).forEach(function (k) { delete _busyCache[k]; });

  const dateEl = document.getElementById('schedule-date');
  if (dateEl) dateEl.textContent = fmtDate(_currentDay);

  showTableLoading();

  const pad    = function (n) { return String(n).padStart(2, '0'); };
  const fmtISO = function (d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const dayStart = new Date(_currentDay);
  const dayEnd   = new Date(_currentDay);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const from = fmtISO(dayStart);
  const to   = fmtISO(dayEnd);

  const calTypes = Object.keys(MP_CALENDARS || {});
  _totalToLoad = calTypes.length;
  _loadedCount = 0;

  if (_totalToLoad === 0) {
    // Календари ещё не подгружены — рендерим пустую таблицу.
    _getRenderTable().then(function (fn) { fn(); });
    return;
  }

  calTypes.forEach(function (calType) {
    _busyCache[calType] = [];

    // Единый запрос для DEV и CRM: тип всегда MP[N]Vstrechi.
    const eventGetParams = { type: calType, ownerId: 0, from: from, to: to };

    BX24.callMethod('calendar.event.get', eventGetParams, function (result) {
      if (!result.error()) {
        const events = result.data() || [];
        if (Array.isArray(events)) {
          _busyCache[calType] = events.filter(function (ev) {
            // DELETED='Y' — событие удалено, не блокирует слот.
            if (ev.DELETED === 'Y') return false;
            // ACCESSIBILITY='free' — пометка «не занимать», доступен для записи.
            if (ev.ACCESSIBILITY === 'free') return false;
            return true;
          });
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[slots] calendar.event.get failed for ${calType}:`, result.error());
      }

      _loadedCount++;
      if (_loadedCount >= _totalToLoad) {
        _getRenderTable().then(function (fn) { fn(); });
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 8: СВОБОДНЫЕ СЛОТЫ
// ══════════════════════════════════════════════════════════════════════════════

/**
 * _eventUtcMs(ev, field) — тонкий wrapper над getEventUtcMs() из tz-utils.js.
 *
 * Реальная логика живёт в anketa-kc/assets/tz-utils.js — единственный модуль
 * работы с таймзонами (задача 6 рефакторинга).
 * Обёртка оставлена для обратной совместимости и фолбэка,
 * если tz-utils.js вдруг не подключён (NaN вместо падения).
 */
function _eventUtcMs(ev, field) {
  if (typeof getEventUtcMs === 'function') {
    return getEventUtcMs(ev, field);
  }
  return NaN;
}

/**
 * buildFreeSlots(mp, day, busy) — массив свободных слотов для одного МП.
 *
 * Алгоритм:
 *   1. Перебираем часы рабочего дня МП [from..to) в его TZ.
 *   2. Для каждого часа считаем UTC-границы слота.
 *   3. Отбрасываем слоты в прошлом.
 *   4. Если день не входит в workDays МП — слотов в этот день нет.
 *   5. Иначе проверяем пересечение с событиями занятости через _eventUtcMs.
 *
 * Доступность слота определяется ТОЛЬКО рабочим графиком и занятостью МП
 * (в TZ МП). TZ клиента на доступность НЕ влияет — он используется лишь для
 * отображения времени в заголовках колонок (см. collectAllHours). Клиент
 * выбирает удобное ему время, а вопрос «работает ли МП в этот абсолютный
 * момент» решается по графику МП. Поэтому слот остаётся доступным, даже если
 * по времени клиента он выходит за «разумные» рамки рабочего дня.
 */
export function buildFreeSlots(mp, day, busy) {
  const cfg       = window.APP_CONFIG || {};
  const slotMs    = (mp.slotMinutes || cfg.slotMin || 60) * 60000;
  const now       = Date.now();
  const slots     = [];

  // Если МП в этот день не работает — пустой список.
  if (Array.isArray(mp.workDays) && mp.workDays.indexOf(day.getDay()) === -1) {
    return slots;
  }

  for (let h = mp.from; h < mp.to; h++) {
    const slotUtcMs    = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), h - mp.utc, 0, 0, 0);
    const slotEndUtcMs = slotUtcMs + slotMs;

    if (slotEndUtcMs <= now) continue;

    const isBusy = busy.some(function (ev) {
      const evFrom = _eventUtcMs(ev, 'DATE_FROM');
      const evTo   = _eventUtcMs(ev, 'DATE_TO');
      if (isNaN(evFrom) || isNaN(evTo)) return false;
      return slotUtcMs < evTo && slotEndUtcMs > evFrom;
    });

    if (isBusy) continue;

    slots.push({ utcMs: slotUtcMs, endUtcMs: slotEndUtcMs, mpUtc: mp.utc });
  }

  return slots;
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 9: ЗАГОЛОВКИ ТАБЛИЦЫ (СБОР ВСЕХ ЧАСОВ)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * collectAllHours(slotsMap) — отсортированный массив уникальных UTC-моментов.
 *
 * Каждый элемент: { utcMs, label } — utcMs для поиска по data-атрибутам,
 * label — отформатированный в TZ клиента (или UTC если TZ неизвестен) "HH:MM".
 */
export function collectAllHours(slotsMap) {
  const utcSet = {};
  Object.keys(slotsMap).forEach(function (calType) {
    (slotsMap[calType] || []).forEach(function (slot) {
      utcSet[slot.utcMs] = true;
    });
  });
  return Object.keys(utcSet)
    .map(function (k) { return parseInt(k, 10); })
    .sort(function (a, b) { return a - b; })
    .map(function (utcMs) {
      const displayOffset = (_clientUtc !== null) ? _clientUtc : 0;
      const label = fmtHour(utcMs, displayOffset);
      return { utcMs: utcMs, label: label };
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 10: УСТАНОВКА TZ КЛИЕНТА
// ══════════════════════════════════════════════════════════════════════════════

export function setClientCity(cityName, silent) {
  if (cityName !== undefined) {
    const tz = _getCityTz(cityName);
    _clientUtc = (tz !== null && tz !== undefined) ? tz : null;
  } else {
    _clientUtc = getClientUtcFromForm();
  }
  _autoJumpCount = 0;
  if (!silent) loadAllSlots();
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 11: UI-СЛУЖЕБНОЕ
// ══════════════════════════════════════════════════════════════════════════════

export function showTableLoading() {
  const panel = document.getElementById('slots-panel');
  if (!panel) return;
  panel.innerHTML =
    '<div class="flex items-center gap-2 py-8 justify-center text-xs text-gray-400">' +
    '<svg class="animate-spin w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24">' +
    '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
    '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"></path></svg>' +
    'Загрузка расписания всех МП…</div>';
}

export function setHiddenField(name, value) {
  let el = document.getElementById(name);
  if (!el) {
    el = document.createElement('input');
    el.type = 'hidden';
    el.id   = name;
    el.name = name;
    const form = document.getElementById('anketa-form');
    if (form) form.appendChild(el);
  }
  el.value = value;
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 12: СЕТТЕРЫ/ГЕТТЕРЫ ДЛЯ ВНЕШНИХ МОДУЛЕЙ
// ══════════════════════════════════════════════════════════════════════════════
//
// ES-модули не позволяют присваивать `export let` снаружи модуля, поэтому
// сеттеры — единственный способ менять состояние из calendar-render и app.js.

export function _setCurrentDay(d) { _currentDay = d; }
export function _setAutoJumpCount(n) { _autoJumpCount = n; }
export function _setBookingInProgress(v) { _bookingInProgress = v; }
export function _setClientUtc(v) { _clientUtc = v; }
export function _setMpCalendars(v) { MP_CALENDARS = v; }

export function getMpCalendars() { return MP_CALENDARS; }
export function getCurrentDay() { return _currentDay; }
export function getClientUtc() { return _clientUtc; }
