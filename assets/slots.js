// =============================================================================
// assets/slots.js — построение расписания МП (v4)
// =============================================================================
//
// КАК РАБОТАЕТ РАСПИСАНИЕ В v4
// ────────────────────────────────────────────────────────────────────────────
//
//   1. loadMpCalendarsFromPortal() сначала вызывает _loadWorkScheduleFromList()
//      — один запрос lists.element.get к универсальному списку B24 (ID=45).
//      Список содержит: calType, utcOffset, workStart, workEnd для каждого МП.
//      Это заменяет хардкод MP_WORK_DEFAULTS из v3.
//
//   2. Затем делает 11 параллельных calendar.section.get, берёт sectionId и
//      имя из Bitrix24, а расписание — из результата шага 1.
//
//   3. На каждый рабочий день loadAllSlots() делает 11 параллельных
//      calendar.event.get. События с DELETED='Y' и ACCESSIBILITY='free'
//      отфильтровываются.
//
//   4. buildFreeSlots() итерируется по слотам с шагом MP_SLOT_MINUTES (30 мин),
//      пересекает с занятостью и возвращает свободные слоты.
//
// ЧТО ИЗМЕНЕНО В v4 (по сравнению с v3)
// ────────────────────────────────────────────────────────────────────────────
//
//   • MP_WORK_DEFAULTS убран из mp-config.js, заменён на lists.element.get.
//   • buildFreeSlots: цикл переписан с часового шага (h++) на минутный
//     (localMin += slotMin) — теперь корректно генерирует 30-минутные слоты.
//   • manifest.json: добавлен scope "lists" (требует переустановки приложения).
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
// БЛОК 1: ЗАГРУЗКА РАСПИСАНИЯ МП ИЗ УНИВЕРСАЛЬНОГО СПИСКА B24
// ══════════════════════════════════════════════════════════════════════════════

/**
 * _loadWorkScheduleFromList(listId) — загружает расписание МП из списка B24.
 *
 * Алгоритм:
 *   1. lists.field.get → узнаём коды свойств по их русским названиям.
 *   2. lists.element.get → читаем все элементы списка.
 *   3. Разбираем каждый элемент: calType, utcOffset, workStart, workEnd.
 *
 * Возвращает словарь: calType → { utcOffset, workStart, workEnd }
 * При любой ошибке возвращает {} (не роняет приложение — calendar.section.get
 * продолжит работу с fallback-значениями).
 *
 * Требует scope "lists" в manifest.json.
 *
 * @param {number} listId — IBLOCK_ID универсального списка (45 на yurclick.com).
 * @returns {Promise<Object>}
 */
async function _loadWorkScheduleFromList(listId) {
  // Шаг 1: получаем определения полей, чтобы узнать коды свойств (PROPERTY_N).
  const fieldDefs = await new Promise(function (resolve) {
    BX24.callMethod('lists.field.get', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: listId
    }, function (result) {
      if (result.error()) {
        // eslint-disable-next-line no-console
        console.warn('[slots] lists.field.get error (нет scope "lists"?):', result.error());
        return resolve(null);
      }
      resolve(result.data() || null);
    });
  });

  if (!fieldDefs) return {};

  // Ищем коды нужных полей по их названию в списке.
  let codeCalType = null, codeUtc = null, codeWorkStart = null, codeWorkEnd = null;
  let utcDisplayVals = {};
  Object.keys(fieldDefs).forEach(function (code) {
    const name = (fieldDefs[code].NAME || '').trim();
    if      (name === 'ID календарь')    codeCalType   = code;
    else if (name === 'UTC')           { codeUtc = code; utcDisplayVals = fieldDefs[code].DISPLAY_VALUES_FORM || {}; }
    else if (name === 'Время работы ОТ') codeWorkStart = code;
    // B24 поле названо «Время работа ДО» (опечатка в портале), принимаем оба варианта.
    else if (name === 'Время работы ДО' || name === 'Время работа ДО') codeWorkEnd = code;
  });

  if (!codeCalType || !codeUtc || !codeWorkStart || !codeWorkEnd) {
    // eslint-disable-next-line no-console
    console.warn('[slots] Не найдены поля списка. Доступные:', Object.keys(fieldDefs).map(function (c) {
      return `${c} = "${fieldDefs[c].NAME}"`;
    }).join(', '));
    return {};
  }

  // Шаг 2: читаем элементы списка.
  const elements = await new Promise(function (resolve) {
    BX24.callMethod('lists.element.get', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: listId
    }, function (result) {
      if (result.error()) {
        // eslint-disable-next-line no-console
        console.warn('[slots] lists.element.get error:', result.error());
        return resolve(null);
      }
      resolve(result.data() || null);
    });
  });

  if (!elements || !Array.isArray(elements)) return {};

  // Шаг 3: разбираем элементы.
  // lists.element.get возвращает свойства как { "propValueId": "actualValue" } —
  // ключ это внутренний ID записи значения, значение — само значение.
  function _getPropVal(el, code) {
    const prop = el[code];
    if (!prop) return '';
    if (Array.isArray(prop)) return (prop[0] && prop[0].value) ? String(prop[0].value) : '';
    if (typeof prop === 'object') {
      if (prop.value !== undefined) return String(prop.value);
      // Формат B24 lists: { "valueRecordId": "actualValue" }
      const vals = Object.values(prop);
      return vals.length ? String(vals[0]) : '';
    }
    return String(prop);
  }

  // Извлекает "HH:MM" из строки вида "10.03.2026 10:00:00" или "2026-03-10T07:00:00+00:00".
  function _parseTime(raw) {
    if (!raw) return null;
    // ISO: T10:00:00
    const iso = raw.match(/T(\d{2}:\d{2}):\d{2}/);
    if (iso) return iso[1];
    // Русский формат: "dd.mm.YYYY HH:MM:SS"
    const ru = raw.match(/\s(\d{2}:\d{2}):\d{2}$/);
    if (ru) return ru[1];
    return null;
  }

  const schedule = {};
  elements.forEach(function (el) {
    const calType = _getPropVal(el, codeCalType).trim();
    if (!calType) return;

    // UTC: поле хранит enum ID (напр. "305"). Находим текст "+03 UTC" через
    // DISPLAY_VALUES_FORM и парсим цифру. Fallback: UTC+3.
    const utcEnumId  = _getPropVal(el, codeUtc);
    const utcDisplay = utcDisplayVals[utcEnumId] || utcEnumId;
    const utcMatch   = utcDisplay.match(/([+-]?\d+)/);
    const utcOffset  = utcMatch ? parseInt(utcMatch[1], 10) : 3;

    // Время работы: нужна только часть HH:MM.
    // Поле хранит дату+время т.к. B24 не поддерживает поля типа «только время».
    const workStart = _parseTime(_getPropVal(el, codeWorkStart));
    const workEnd   = _parseTime(_getPropVal(el, codeWorkEnd));

    if (!workStart || !workEnd) {
      // eslint-disable-next-line no-console
      console.warn(`[slots] Список: пропускаем "${el.NAME || calType}" — нет времени работы`);
      return;
    }

    schedule[calType] = { utcOffset: utcOffset, workStart: workStart, workEnd: workEnd };
    // eslint-disable-next-line no-console
    console.info(`[slots] Список: ${el.NAME || calType} → ${workStart}–${workEnd} UTC+${utcOffset}`);
  });

  // eslint-disable-next-line no-console
  console.info(`[slots] Загружено расписаний из списка ${listId}: ${Object.keys(schedule).length}/${elements.length}`);
  return schedule;
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 2: ЗАГРУЗКА КАЛЕНДАРЕЙ МП ИЗ ПОРТАЛА
// ══════════════════════════════════════════════════════════════════════════════

/**
 * loadMpCalendarsFromPortal() → Promise<{ MP1Vstrechi: {...}, ... }>
 *
 * 1. Загружает расписание из списка B24 (_loadWorkScheduleFromList).
 * 2. Параллельно делает N запросов calendar.section.get (по одному на МП).
 * 3. Для каждого МП объединяет данные из списка (utc, workStart, workEnd)
 *    с данными из секции (sectionId, name) и из mp-config.js (workDays, enumId).
 *
 * Формат элемента словаря MP_CALENDARS (ключ — CAL_TYPE, например "MP2Vstrechi"):
 *   {
 *     number:      2,
 *     calType:     "MP2Vstrechi",
 *     sectionId:   "15",
 *     name:        "МП2 - Мария Прокопьева",
 *     label:       "МП2 - Мария Прокопьева",
 *     short:       "МП 2",
 *     utc:         3,            // из списка B24
 *     from:        9,            // часы workStart (целые, для совместимости)
 *     to:          17,           // часы workEnd
 *     workStart:   "09:00",      // из списка B24
 *     workEnd:     "17:00",      // из списка B24
 *     workDays:    [1,2,3,4,5],  // из MP_WORK_DAYS (mp-config.js)
 *     slotMinutes: 30,           // из MP_SLOT_MINUTES (mp-config.js)
 *     enumId:      2100          // из MP_BOOKING_ENUM_MAP (mp-config.js)
 *   }
 */
export async function loadMpCalendarsFromPortal() {
  const numbers       = (typeof MP_NUMBERS          !== 'undefined') ? MP_NUMBERS          : [1,2,3,4,5,6,7,8,9,10,11];
  const enumMap       = (typeof MP_BOOKING_ENUM_MAP !== 'undefined') ? MP_BOOKING_ENUM_MAP : {};
  const workDaysMap   = (typeof MP_WORK_DAYS        !== 'undefined') ? MP_WORK_DAYS        : {};
  const slotMinutes   = (typeof MP_SLOT_MINUTES     !== 'undefined') ? MP_SLOT_MINUTES     : 30;
  const listId        = (typeof MP_LIST_ID          !== 'undefined') ? MP_LIST_ID          : 45;
  const isDev         = (typeof APP_CONFIG          !== 'undefined') && APP_CONFIG.appEnv === 'dev';
  const devSectionIds = (typeof MP_DEV_SECTION_IDS  !== 'undefined') ? MP_DEV_SECTION_IDS  : {};

  // Загружаем расписание из B24 списка (заменяет MP_WORK_DEFAULTS).
  const listSchedule = await _loadWorkScheduleFromList(listId);

  const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]; // Пн-Пт по умолчанию

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

        const calType  = `MP${n}Vstrechi`;
        const sections = result.data() || [];

        // Расписание: берём из списка, при отсутствии — минимальный fallback.
        const ls        = listSchedule[calType] || null;
        const workStart = ls ? ls.workStart : '09:00';
        const workEnd   = ls ? ls.workEnd   : '18:00';
        const utcOffset = ls ? ls.utcOffset : 3;
        const from      = parseInt(workStart.split(':')[0], 10);
        const to        = parseInt(workEnd.split(':')[0],   10);

        if (!ls) {
          // eslint-disable-next-line no-console
          console.warn(`[slots] ${calType}: расписание не найдено в списке, используется fallback 09:00-18:00 UTC+3`);
        }

        // Дни работы из MP_WORK_DAYS[calType], иначе Mon-Fri.
        const workDays = workDaysMap[calType] || DEFAULT_WORK_DAYS;

        const entry = {
          number:      n,
          calType:     calType,
          short:       `МП ${n}`,
          utc:         utcOffset,
          from:        from,
          to:          to,
          workStart:   workStart,
          workEnd:     workEnd,
          workDays:    workDays,
          slotMinutes: slotMinutes,
          enumId:      (enumMap[n] != null) ? enumMap[n] : null
        };

        if (Array.isArray(sections) && sections.length > 0) {
          const sec = sections[0];
          entry.sectionId = sec.ID;
          entry.name      = sec.NAME || `МП ${n}`;
          entry.label     = sec.NAME || `МП ${n}`;
          resolve([calType, entry]);

        } else if (isDev && devSectionIds[n]) {
          // eslint-disable-next-line no-console
          console.info(`[slots] DEV fallback: ${calType} не найдена по типу, sectionId=${devSectionIds[n]}`);
          entry.sectionId = String(devSectionIds[n]);
          entry.name      = `МП ${n}`;
          entry.label     = `МП ${n}`;
          resolve([calType, entry]);

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
  console.info(`[slots] Загружено календарей МП: ${Object.keys(dict).length}/${numbers.length}`);
  return dict;
}

// ══════════════════════════════════════════════════════════════════════════════
// БЛОК 3: TZ КЛИЕНТА (городской справочник)
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
 *   1. Если день не входит в workDays МП — возвращаем [].
 *   2. Шагаем по слотам с шагом slotMinutes от workStart до workEnd в TZ МП.
 *   3. Для каждого слота вычисляем UTC-границы через Date.UTC с минутной арифметикой.
 *   4. Отбрасываем слоты в прошлом.
 *   5. Проверяем пересечение с занятыми событиями через _eventUtcMs.
 *
 * Доступность слота определяется ТОЛЬКО рабочим графиком и занятостью МП
 * (в TZ МП). TZ клиента на доступность НЕ влияет — он используется лишь для
 * отображения времени в заголовках колонок (см. collectAllHours). Клиент
 * выбирает удобное ему время, а вопрос «работает ли МП в этот абсолютный
 * момент» решается по графику МП. Поэтому слот остаётся доступным, даже если
 * по времени клиента он выходит за «разумные» рамки рабочего дня.
 */
export function buildFreeSlots(mp, day, busy) {
  const cfg      = window.APP_CONFIG || {};
  const slotMin  = mp.slotMinutes || cfg.slotMin || 30;
  const slotMs   = slotMin * 60000;
  const now      = Date.now();
  const slots    = [];

  // Если МП в этот день не работает — пустой список.
  if (Array.isArray(mp.workDays) && mp.workDays.indexOf(day.getDay()) === -1) {
    return slots;
  }

  // Рабочее время в минутах от начала суток (локальное время МП).
  // Используем workStart/workEnd (HH:MM) для точности — mp.from/mp.to хранят
  // только целые часы и могут потерять минуты если workStart = "09:30".
  function _hhmm2min(hhmm) {
    const parts = (hhmm || '').split(':');
    return parseInt(parts[0], 10) * 60 + (parseInt(parts[1], 10) || 0);
  }
  const startLocalMin = _hhmm2min(mp.workStart) || mp.from * 60;
  const endLocalMin   = _hhmm2min(mp.workEnd)   || mp.to   * 60;

  // Шагаем по слотам с шагом slotMin.
  // Date.UTC корректно обрабатывает minutes вне [0,59]: автоматически
  // переносит в часы/дни, поэтому формула (localMin - mp.utc*60) работает
  // даже при отрицательном результате (слот МП до полуночи UTC).
  for (let localMin = startLocalMin; localMin < endLocalMin; localMin += slotMin) {
    const slotUtcMs    = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 0, localMin - mp.utc * 60, 0, 0);
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
