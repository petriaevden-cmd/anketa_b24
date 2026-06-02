/**
 * tz-utils.js — единый модуль для работы с временными зонами.
 *
 * Централизованы здесь, чтобы любое изменение логики (например, переход
 * с ручной арифметики на Intl.DateTimeFormat) применялось сразу везде,
 * а не нужно было искать дублирующийся код в нескольких файлах.
 *
 * До завершения задачи 4 (перехода на ES-модули) функции экспортируются
 * как глобальные через window — webhook-client.js ещё не модуль и должен
 * иметь возможность вызывать makeIsoWithTz() напрямую.
 * После задачи 4 этот файл превращается в полноценный ES-модуль с export.
 */

'use strict';

(function (global) {

  /**
   * makeIsoWithTz(dateStr, tzName, utcTs) → ISO-строка UTC
   *
   * Конвертирует дату из формата Bitrix24 («dd.mm.YYYY HH:MM:SS» в зоне TZ)
   * в ISO-строку UTC с суффиксом Z.
   *
   * Стратегия (в порядке надёжности):
   *   1. Если есть utcTs (DATE_FROM_TS_UTC) — самый точный источник.
   *   2. Если есть tzName — вычисляем смещение через Intl.DateTimeFormat.
   *   3. Fallback — считаем строку уже UTC.
   *
   * @param {string} dateStr  — «dd.mm.YYYY HH:MM:SS»
   * @param {string} tzName   — «Europe/Moscow», «Asia/Yekaterinburg», …
   * @param {string|number} utcTs — UTC-timestamp в секундах (из ответа Bitrix24)
   * @returns {string} ISO-строка, например «2024-12-25T11:00:00.000Z»
   */
  function makeIsoWithTz(dateStr, tzName, utcTs) {
    // Ветка 1: готовый UTC-timestamp — самый точный путь.
    if (utcTs) {
      const tsNum = parseInt(utcTs, 10);
      if (!isNaN(tsNum)) return new Date(tsNum * 1000).toISOString();
    }

    if (!dateStr || typeof dateStr !== 'string') return dateStr;
    if (/^\d{4}-\d{2}-\d{2}T/.test(dateStr)) return dateStr;

    const m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(dateStr);
    if (!m) return dateStr;

    const Y = +m[3], Mo = +m[2], D = +m[1], h = +m[4], mi = +m[5], s = +m[6];

    // Ветка 2: вычисляем смещение зоны через Intl.DateTimeFormat.
    if (tzName) {
      try {
        const asUtc = Date.UTC(Y, Mo - 1, D, h, mi, s);
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: tzName, hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).formatToParts(new Date(asUtc));
        const p = {};
        parts.forEach(function (x) { p[x.type] = x.value; });
        const zonedUtc = Date.UTC(+p.year, +p.month - 1, +p.day,
          +(p.hour === '24' ? 0 : p.hour), +p.minute, +p.second);
        const offsetMs = zonedUtc - asUtc;
        const trueUtc = asUtc - offsetMs;
        return new Date(trueUtc).toISOString();
      } catch (e) {
        // Intl недоступен — падаем на ветку 3.
      }
    }

    // Ветка 3: записываем как UTC (крайний случай).
    const padN = function (n) { return String(n).padStart(2, '0'); };
    return `${m[3]}-${m[2]}-${m[1]}T${padN(h)}:${padN(mi)}:${padN(s)}Z`;
  }

  /**
   * getEventUtcMs(ev, field) → UTC-миллисекунды границы события Bitrix24.
   *
   * Событие из calendar.event.get имеет несколько способов указать время:
   *   1. DATE_FROM_TS_UTC / DATE_TO_TS_UTC — готовый UTC-timestamp в секундах.
   *      Самый надёжный источник — используем в первую очередь.
   *   2. DATE_FROM/DATE_TO в формате "dd.mm.YYYY HH:MM:SS" + TZ_FROM/TZ_TO
   *      с именем таймзоны ("Europe/Samara") — fallback через makeIsoWithTz.
   *   3. Deep fallback: парсим строку и считаем как UTC+3 (Москва).
   *
   * Раньше в v2 здесь форсилось 'Europe/Moscow' и игнорировался TZ_FROM —
   * это давало сдвиг на 1 час для самарских событий (UTC+4 vs UTC+3).
   *
   * @param {object} ev    — событие из calendar.event.get
   * @param {string} field — 'DATE_FROM' или 'DATE_TO'
   * @returns {number} UTC-мс или NaN при ошибке
   */
  function getEventUtcMs(ev, field) {
    if (!ev) return NaN;

    // На DEV-портале (dev.yurclick.com) поля _TS_UTC содержат неправильное значение
    // (локальное время портала вместо UTC). Поэтому на DEV сразу идём к строке + TZ.
    // На CRM timestamp надёжен — используем его в первую очередь.
    const isDev = (typeof window !== 'undefined' &&
                  typeof window.APP_CONFIG !== 'undefined' &&
                  window.APP_CONFIG.appEnv === 'dev');

    if (!isDev) {
      // Приоритет 1 (CRM): готовый UTC-timestamp.
      const tsField = (field === 'DATE_FROM') ? 'DATE_FROM_TS_UTC' : 'DATE_TO_TS_UTC';
      const ts = ev[tsField];
      if (ts != null && ts !== '') {
        const num = Number(ts);
        if (!isNaN(num)) return num * 1000;
      }
    }

    // Приоритет 2 (CRM фоллбэк / DEV основной путь): строка + TZ события.
    const dateStr = ev[field] || '';
    if (!dateStr) return NaN;
    const tzField = (field === 'DATE_FROM') ? 'TZ_FROM' : 'TZ_TO';
    const tzName  = ev[tzField] || 'Europe/Moscow';

    return new Date(makeIsoWithTz(dateStr, tzName, null)).getTime();
  }

  /**
   * localTimeToUtcMinutes(localMinutes, tzOffsetHours) → число минут UTC
   *
   * Пересчитывает минуты-от-начала-суток из локального времени МП в UTC.
   * Нормализует результат в диапазон [0, 1439].
   *
   * @param {number} localMinutes   — время начала слота в минутах от полуночи (локальное)
   * @param {number} tzOffsetHours  — UTC-смещение из CITIES_TZ (например, 4 для Самары)
   * @returns {number} — минуты UTC в диапазоне [0, 1439]
   */
  function localTimeToUtcMinutes(localMinutes, tzOffsetHours) {
    const utcM = localMinutes - tzOffsetHours * 60;
    // Формула ((x % N) + N) % N — стандартная нормализация остатка, защищает
    // от отрицательных значений: когда workStart МП раньше UTC-смещения,
    // вычитание даёт отрицательное число, а обычный % вернул бы отрицательный остаток.
    return ((utcM % 1440) + 1440) % 1440;
  }

  /**
   * formatHHMM(totalMinutes) → «HH:MM»
   *
   * Форматирует число минут от начала суток в строку «ЧЧ:ММ».
   * Вынесено, чтобы не дублировать padStart(2,'0') в каждом месте.
   *
   * @param {number} totalMinutes — минуты от 0 до 1439
   * @returns {string} — например, «09:05»
   */
  function formatHHMM(totalMinutes) {
    const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const m = String(totalMinutes % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  /**
   * getCityOffset(cityName) → число | null
   *
   * Обёртка над getCityTZ() из cities.js с защитой от случая,
   * когда cities.js не загружен.
   *
   * @param {string} cityName — ключ из CITIES_TZ
   * @returns {number|null} — UTC-смещение в часах или null
   */
  function getCityOffset(cityName) {
    return (typeof global.getCityTZ === 'function') ? global.getCityTZ(cityName) : null;
  }

  // Экспорт в глобальную область — webhook-client.js (не-модуль) и mp-config.js
  // (тоже не-модуль) вызывают эти функции напрямую. После задачи 4 будет
  // добавлен ES-модульный export.
  global.makeIsoWithTz = makeIsoWithTz;
  global.getEventUtcMs = getEventUtcMs;
  global.localTimeToUtcMinutes = localTimeToUtcMinutes;
  global.formatHHMM = formatHHMM;
  global.getCityOffset = getCityOffset;

  // Экспорт для Node.js / Jest — позволяет покрыть формулы unit-тестами
  // без изменения основного кода (см. mp-config.js — тот же приём).
  if (typeof module !== 'undefined') {
    module.exports = { makeIsoWithTz, getEventUtcMs, localTimeToUtcMinutes, formatHHMM, getCityOffset };
  }

})(typeof window !== 'undefined' ? window : this);
