// =============================================================================
// test/slots-availability-test.js
// =============================================================================
//
// Регрессионный unit-тест на buildFreeSlots(): доступность слота определяется
// рабочим графиком МП (в TZ МП), а НЕ временем клиента. TZ клиента влияет
// только на отображение. Запуск:
//
//   node test/slots-availability-test.js
//
// Выход != 0, если хоть одно утверждение провалилось.
// =============================================================================

'use strict';

// slots.js обращается к window.APP_CONFIG — подставляем минимальный стаб.
globalThis.window = { APP_CONFIG: { slotMin: 60 } };

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    // eslint-disable-next-line no-console
    console.log(`  ok  - ${msg}`);
  } else {
    failures++;
    // eslint-disable-next-line no-console
    console.error(`  FAIL - ${msg}`);
  }
}

(async function main() {
  const slots = await import('../assets/slots.js');
  const { buildFreeSlots, _setClientUtc } = slots;

  // МП в Самаре (UTC+4), работает Пн–Пт 09:00–20:00, слот 60 мин.
  const samaraMp = {
    utc: 4,
    from: 9,
    to: 20,
    workDays: [1, 2, 3, 4, 5],
    slotMinutes: 60
  };

  // Берём заведомо будущий будний день (понедельник), чтобы фильтр «прошлое»
  // не выкидывал слоты независимо от текущей даты прогона.
  const day = new Date(Date.UTC(2100, 0, 4, 0, 0, 0, 0)); // 2100-01-04 — понедельник
  assert(day.getUTCDay() === 1, 'тестовый день — понедельник (workday)');

  // Без занятости.
  const noBusy = [];

  // --- Кейс 1: клиент во Владивостоке (UTC+10) ---------------------------------
  // Последний слот МП — 19:00 Самары (UTC 15:00) = 01:00 следующего дня во
  // Владивостоке. Раньше фильтр 09:00–20:00 по клиенту его выкидывал. Теперь
  // он должен остаться.
  _setClientUtc(10);
  const vladSlots = buildFreeSlots(samaraMp, day, noBusy);

  // Ожидаем ровно 11 слотов: часы 9..19 МП (to=20 не включается).
  assert(vladSlots.length === 11,
    `Владивосток: 11 слотов (полный рабочий день МП), получено ${vladSlots.length}`);

  // Самый поздний слот МП — старт 19:00 Самары = UTC 15:00.
  const lastSlotUtc = Date.UTC(2100, 0, 4, 19 - samaraMp.utc, 0, 0, 0);
  const hasLateSlot = vladSlots.some((s) => s.utcMs === lastSlotUtc);
  assert(hasLateSlot,
    'Владивосток: поздний слот 19:00 Самары (01:00 по клиенту) доступен');

  // --- Кейс 2: TZ клиента не задан (null) --------------------------------------
  _setClientUtc(null);
  const noTzSlots = buildFreeSlots(samaraMp, day, noBusy);
  assert(noTzSlots.length === 11,
    `Без TZ клиента: 11 слотов, получено ${noTzSlots.length}`);

  // --- Кейс 3: TZ клиента не меняет число доступных слотов ---------------------
  // Доступность одинакова при любом клиентском смещении (Калининград UTC+2,
  // Москва UTC+3, Владивосток UTC+10).
  const counts = [2, 3, 10].map((tz) => {
    _setClientUtc(tz);
    return buildFreeSlots(samaraMp, day, noBusy).length;
  });
  assert(counts.every((c) => c === 11),
    `Число слотов не зависит от TZ клиента: [${counts.join(', ')}]`);

  // --- Кейс 4: МП не работает в выходной ---------------------------------------
  const sunday = new Date(Date.UTC(2100, 0, 3, 0, 0, 0, 0)); // воскресенье
  assert(sunday.getUTCDay() === 0, 'тестовый день — воскресенье (не workday)');
  _setClientUtc(10);
  const sundaySlots = buildFreeSlots(samaraMp, sunday, noBusy);
  assert(sundaySlots.length === 0,
    'Выходной МП: слотов нет независимо от TZ клиента');

  // -----------------------------------------------------------------------------
  if (failures > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failures} проверок провалено`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('\nВсе проверки пройдены');
})();
