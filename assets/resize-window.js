/**
 * resize-window.js — увеличение iframe приложения в Битрикс24.
 *
 * Устанавливает высоту iframe равной 75% от screen.availHeight пользователя
 * через BX24.resizeWindow(0, height) — ширину не меняет (0 = оставить как есть).
 *
 * BX24.fitWindow() НЕ используется: он подгоняет высоту под document.scrollHeight,
 * а при фиксированном макете (overflow:hidden / height:100vh) это no-op.
 *
 * SDK-документация:
 *   https://apidocs.bitrix24.ru/sdk/bx24-js-sdk/additional-functions/bx24-resize-window.html
 *
 * Вне iframe Битрикс24 (dev/standalone, webhook-shim из webhook-client.js)
 * все вызовы безопасно превращаются в no-op.
 */

const DEBOUNCE_MS = 150;

let _debounceTimer = null;

/**
 * _bx24ResizeAvailable() — true только при настоящем SDK с методом resizeWindow.
 */
function _bx24ResizeAvailable() {
  return typeof window !== 'undefined' &&
    window.BX24 &&
    typeof window.BX24.resizeWindow === 'function';
}

/**
 * fitWindowNow — немедленно просит портал развернуть фрейм на максимум.
 * Использует BX24.resizeWindow(availWidth, availHeight).
 * Вне iframe портала — тихий no-op (callback всё равно вызывается).
 *
 * @param {Function} [callback]
 * @returns {boolean} true, если команда отправлена в SDK.
 */
export function fitWindowNow(callback) {
  if (!_bx24ResizeAvailable()) {
    if (typeof callback === 'function') callback();
    return false;
  }
  try {
    const h = Math.round(((window.screen && window.screen.availHeight) || 900) * 0.85);
    const cb = typeof callback === 'function' ? callback : undefined;
    window.BX24.resizeWindow(0, h, cb);
    return true;
  } catch (e) {
    console.warn('resize-window: не удалось изменить размер фрейма', e);
    return false;
  }
}

/**
 * fitWindow — дебаунсированная версия fitWindowNow.
 *
 * @param {Function} [callback]
 */
export function fitWindow(callback) {
  if (!_bx24ResizeAvailable()) {
    if (typeof callback === 'function') callback();
    return;
  }
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(function () {
    _debounceTimer = null;
    fitWindowNow(callback);
  }, DEBOUNCE_MS);
}
