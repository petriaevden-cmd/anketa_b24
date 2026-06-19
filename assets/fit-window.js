/**
 * fit-window.js — максимизация iframe приложения в Битрикс24.
 *
 * Использует BX24.resizeWindow(width, height) для установки размеров фрейма
 * равными доступной области экрана пользователя (window.screen.availWidth /
 * availHeight). Портал сам ограничивает размер своим контейнером, поэтому
 * передача "экрана целиком" надёжно даёт максимально возможный размер.
 *
 * BX24.fitWindow() НЕ используется для этой задачи: он подгоняет высоту фрейма
 * под document.scrollHeight, а при фиксированном макете (overflow:hidden /
 * height:100vh) scrollHeight = текущая высота фрейма → no-op. Кроме того,
 * fitWindow не меняет ширину.
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
    const w = (window.screen && window.screen.availWidth)  || 9999;
    const h = (window.screen && window.screen.availHeight) || 9999;
    const cb = typeof callback === 'function' ? callback : undefined;
    window.BX24.resizeWindow(w, h, cb);
    return true;
  } catch (e) {
    console.warn('fit-window: не удалось изменить размер фрейма', e);
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
