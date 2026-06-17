// =============================================================================
// test/fit-window-test.js
// =============================================================================
//
// Позитивный unit-тест на assets/fit-window.js. Проверяет, что обёртка над
// BX24.fitWindow:
//   1. реально вызывает BX24.fitWindow в SDK-режиме (fitWindowNow);
//   2. прокидывает callback в SDK;
//   3. дебаунсит серию вызовов fitWindow() в один вызов SDK;
//   4. безопасно становится no-op вне портала (нет BX24.fitWindow) —
//      это сценарий standalone/прототип/webhook-shim.
//
// Браузер не нужен: модуль импортируется в Node с подменой window.BX24.
//
//   node test/fit-window-test.js
//
// Выход != 0, если хоть одно утверждение провалилось.
// =============================================================================

'use strict';

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

// Управляемый стаб window.BX24 со шпионом на fitWindow. Модуль читает
// window.BX24 динамически при каждом вызове, поэтому переключать наличие
// fitWindow между фазами теста можно прямо на этом объекте.
let fitCalls = 0;
let lastCallbackInvoked = false;
const BX24_SPY = {
  fitWindow: function (cb) {
    fitCalls++;
    if (typeof cb === 'function') {
      lastCallbackInvoked = true;
      cb();
    }
  }
};
globalThis.window = { BX24: BX24_SPY };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  const { fitWindow, fitWindowNow } = await import('../assets/fit-window.js');

  // ── 1. SDK-режим: fitWindowNow вызывает BX24.fitWindow немедленно ──────────
  fitCalls = 0;
  const sent = fitWindowNow();
  assert(fitCalls === 1, 'fitWindowNow вызывает BX24.fitWindow один раз');
  assert(sent === true, 'fitWindowNow возвращает true, когда команда отправлена');

  // ── 2. callback прокидывается в SDK ───────────────────────────────────────
  lastCallbackInvoked = false;
  fitWindowNow(function () {});
  assert(lastCallbackInvoked === true, 'fitWindowNow прокидывает callback в BX24.fitWindow');

  // ── 3. Дебаунс: серия fitWindow() схлопывается в один вызов SDK ────────────
  fitCalls = 0;
  fitWindow();
  fitWindow();
  fitWindow();
  fitWindow();
  assert(fitCalls === 0, 'fitWindow не вызывает SDK синхронно (ждёт дебаунс)');
  await sleep(250); // больше DEBOUNCE_MS (150)
  assert(fitCalls === 1, 'серия из 4 fitWindow() даёт ровно 1 вызов SDK (дебаунс)');

  // ── 4. Standalone-безопасность: без BX24.fitWindow — чистый no-op ──────────
  globalThis.window.BX24 = { /* как webhook-shim: метода fitWindow нет */ };
  fitCalls = 0;
  const sentOff = fitWindowNow();
  assert(sentOff === false, 'fitWindowNow возвращает false вне портала (нет fitWindow)');
  assert(fitCalls === 0, 'вне портала BX24.fitWindow не вызывается (no-op)');

  let cbRanOffline = false;
  fitWindowNow(function () { cbRanOffline = true; });
  assert(cbRanOffline === true, 'вне портала callback всё равно вызывается (совместимость)');

  fitWindow();
  await sleep(250);
  assert(fitCalls === 0, 'вне портала дебаунсированный fitWindow тоже no-op');

  // ── Итог ──────────────────────────────────────────────────────────────────
  if (failures === 0) {
    // eslint-disable-next-line no-console
    console.log('\nВсе проверки пройдены');
    process.exit(0);
  } else {
    // eslint-disable-next-line no-console
    console.error(`\n${failures} проверок провалено`);
    process.exit(1);
  }
})();
