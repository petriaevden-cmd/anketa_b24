/**
 * resize-window.js — увеличение iframe приложения в Битрикс24.
 *
 * Стратегия (в порядке приоритета):
 *   1. BX24.resizeWindow(0, h) — явно задаёт высоту 85% screen.availHeight,
 *      ширину не трогает (0 = оставить как есть).
 *   2. BX24.fitWindow() — fallback если resizeWindow недоступен: подгоняет
 *      высоту фрейма под document.scrollHeight. При фиксированном макете
 *      (overflow:hidden / height:100vh) это no-op, но лучше, чем ничего.
 *
 * Вне iframe Битрикс24 (dev/standalone, webhook-shim) — тихий no-op.
 */

const DEBOUNCE_MS = 150;

let _debounceTimer = null;

function _hasBx24() {
  return typeof window !== 'undefined' && window.BX24;
}

/**
 * fitWindowNow — немедленно увеличивает iframe.
 * @param {Function} [callback]
 * @returns {boolean} true, если команда отправлена в SDK.
 */
export function fitWindowNow(callback) {
  if (!_hasBx24()) {
    if (typeof callback === 'function') callback();
    return false;
  }
  const cb = typeof callback === 'function' ? callback : undefined;
  try {
    if (typeof window.BX24.resizeWindow === 'function') {
      const h = Math.round(((window.screen && window.screen.availHeight) || 900) * 0.85);
      window.BX24.resizeWindow(0, h, cb);
      return true;
    }
    if (typeof window.BX24.fitWindow === 'function') {
      window.BX24.fitWindow(cb);
      return true;
    }
  } catch (e) {
    console.warn('resize-window: не удалось изменить размер фрейма', e);
  }
  if (typeof callback === 'function') callback();
  return false;
}

/**
 * fitWindow — дебаунсированная версия fitWindowNow.
 * @param {Function} [callback]
 */
export function fitWindow(callback) {
  if (!_hasBx24()) {
    if (typeof callback === 'function') callback();
    return;
  }
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(function () {
    _debounceTimer = null;
    fitWindowNow(callback);
  }, DEBOUNCE_MS);
}
