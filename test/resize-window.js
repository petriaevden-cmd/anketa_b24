// test/resize-window.js
//
// Проверяет resize-window.js:
//   1. resizeWindow доступен → вызывается с h=85% availHeight, w=0;
//   2. callback прокидывается;
//   3. дебаунс схлопывает серию в один вызов;
//   4. fallback на fitWindow если resizeWindow недоступен;
//   5. no-op вне портала (нет BX24).
//
//   node test/resize-window.js

'use strict';

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ok  - ${msg}`); }
  else { failures++; console.error(`  FAIL - ${msg}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  const mod = await import('../assets/resize-window.js');
  const { fitWindow, fitWindowNow } = mod;

  // ── 1. resizeWindow доступен ─────────────────────────────────────────────
  let resizeCalls = 0, fitCalls = 0, lastW, lastH, lastCb = false;
  globalThis.window = {
    BX24: {
      resizeWindow: (w, h, cb) => { resizeCalls++; lastW = w; lastH = h; if (typeof cb === 'function') { lastCb = true; cb(); } },
      fitWindow:    (cb)       => { fitCalls++;                           if (typeof cb === 'function') cb(); }
    },
    screen: { availWidth: 1920, availHeight: 1080 }
  };

  const sent = fitWindowNow();
  assert(sent === true,      'fitWindowNow возвращает true (resizeWindow доступен)');
  assert(resizeCalls === 1,  'вызывает BX24.resizeWindow один раз');
  assert(fitCalls === 0,     'BX24.fitWindow не вызывается когда есть resizeWindow');
  assert(lastW === 0,        'ширина = 0 (не меняется)');
  assert(lastH === 918,      'высота = 85% × 1080 = 918');

  // ── 2. callback ──────────────────────────────────────────────────────────
  lastCb = false;
  fitWindowNow(function () {});
  assert(lastCb === true, 'callback прокидывается в BX24.resizeWindow');

  // ── 3. дебаунс ───────────────────────────────────────────────────────────
  resizeCalls = 0;
  fitWindow(); fitWindow(); fitWindow(); fitWindow();
  assert(resizeCalls === 0, 'fitWindow не вызывает SDK синхронно');
  await sleep(250);
  assert(resizeCalls === 1, 'серия из 4 fitWindow() → 1 вызов SDK');

  // ── 4. fallback на fitWindow если resizeWindow недоступен ────────────────
  resizeCalls = 0; fitCalls = 0;
  globalThis.window.BX24 = {
    fitWindow: (cb) => { fitCalls++; if (typeof cb === 'function') cb(); }
  };
  const sent2 = fitWindowNow();
  assert(sent2 === true,   'fitWindowNow возвращает true (fallback fitWindow)');
  assert(fitCalls === 1,   'BX24.fitWindow вызывается как fallback');
  assert(resizeCalls === 0,'BX24.resizeWindow не вызывается (его нет)');

  // ── 5. no-op вне портала ─────────────────────────────────────────────────
  globalThis.window = { BX24: null };
  fitCalls = 0; resizeCalls = 0;
  const sent3 = fitWindowNow();
  assert(sent3 === false, 'fitWindowNow возвращает false вне портала');

  let cbRan = false;
  fitWindowNow(() => { cbRan = true; });
  assert(cbRan === true, 'вне портала callback всё равно вызывается');

  globalThis.window = { BX24: null };
  await sleep(250);
  assert(fitCalls === 0 && resizeCalls === 0, 'вне портала нет вызовов SDK');

  // ── итог ─────────────────────────────────────────────────────────────────
  if (failures === 0) { console.log('\nВсе проверки пройдены'); process.exit(0); }
  else { console.error(`\n${failures} проверок провалено`); process.exit(1); }
})();
