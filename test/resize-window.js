// =============================================================================
// test/resize-window.js
// =============================================================================
//
// Проверяет resize-window.js (BX24.resizeWindow):
//   1. вызывает BX24.resizeWindow немедленно (fitWindowNow);
//   2. передаёт ширину=0 и высоту=75% screen.availHeight;
//   3. прокидывает callback в SDK;
//   4. дебаунсит серию вызовов в один вызов SDK;
//   5. no-op вне портала (нет BX24.resizeWindow).
//
//   node test/resize-window.js
//
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

let resizeCalls = 0;
let lastW = 0;
let lastH = 0;
let lastCallbackInvoked = false;

const BX24_SPY = {
  resizeWindow: function (w, h, cb) {
    resizeCalls++;
    lastW = w;
    lastH = h;
    if (typeof cb === 'function') {
      lastCallbackInvoked = true;
      cb();
    }
  }
};

globalThis.window = {
  BX24: BX24_SPY,
  screen: { availWidth: 1920, availHeight: 1080 }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  const { fitWindow, fitWindowNow } = await import('../assets/resize-window.js');

  // ── 1. SDK-режим: fitWindowNow вызывает BX24.resizeWindow немедленно ────────
  resizeCalls = 0;
  const sent = fitWindowNow();
  assert(resizeCalls === 1, 'fitWindowNow вызывает BX24.resizeWindow один раз');
  assert(sent === true, 'fitWindowNow возвращает true, когда команда отправлена');

  // ── 2. Передаёт правильные размеры (ширина=0, высота=75% availHeight) ────
  assert(lastW === 0, 'fitWindowNow передаёт 0 как ширину (не меняет)');
  assert(lastH === 918, 'fitWindowNow передаёт 85% screen.availHeight как высоту (1080*0.85=918)');

  // ── 3. callback прокидывается в SDK ──────────────────────────────────────
  lastCallbackInvoked = false;
  fitWindowNow(function () {});
  assert(lastCallbackInvoked === true, 'fitWindowNow прокидывает callback в BX24.resizeWindow');

  // ── 4. Дебаунс: серия fitWindow() схлопывается в один вызов SDK ──────────
  resizeCalls = 0;
  fitWindow();
  fitWindow();
  fitWindow();
  fitWindow();
  assert(resizeCalls === 0, 'fitWindow не вызывает SDK синхронно (ждёт дебаунс)');
  await sleep(250); // больше DEBOUNCE_MS (150)
  assert(resizeCalls === 1, 'серия из 4 fitWindow() даёт ровно 1 вызов SDK (дебаунс)');

  // ── 5. Standalone-безопасность: без BX24.resizeWindow — чистый no-op ─────
  globalThis.window.BX24 = {};
  resizeCalls = 0;
  const sentOff = fitWindowNow();
  assert(sentOff === false, 'fitWindowNow возвращает false вне портала (нет resizeWindow)');
  assert(resizeCalls === 0, 'вне портала BX24.resizeWindow не вызывается (no-op)');

  let cbRanOffline = false;
  fitWindowNow(function () { cbRanOffline = true; });
  assert(cbRanOffline === true, 'вне портала callback всё равно вызывается (совместимость)');

  fitWindow();
  await sleep(250);
  assert(resizeCalls === 0, 'вне портала дебаунсированный fitWindow тоже no-op');

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
