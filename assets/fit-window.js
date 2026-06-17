/**
 * fit-window.js — безопасная обёртка над официальным BX24.fitWindow.
 *
 * SDK-докуметация:
 *   https://apidocs.bitrix24.ru/sdk/bx24-js-sdk/additional-functions/bx24-fit-window.html
 * BX24.fitWindow() просит портал изменить высоту iframe приложения под высоту
 * контента документа (внутри использует BX24.getScrollSize().scrollHeight).
 *
 * ─── ВАЖНОЕ ОГРАНИЧЕНИЕ ПО ТЕКУЩЕМУ МАКЕТУ ──────────────────────────────────
 * Приложение встроено как вкладка CRM_LEAD_DETAIL_TAB и СОЗНАТЕЛЬНО свёрстано
 * фиксированным двухпанельным макетом (см. docs/design-system.md):
 *     html, body { overflow: hidden; }
 *     #app       { height: 100vh; overflow: hidden; }
 *     .panel-scroll / .overflow-y-auto — внутренний скролл панелей.
 * При таком макете документ НИКОГДА не выходит за пределы вьюпорта, поэтому
 * getScrollSize().scrollHeight ≈ текущая высота фрейма, и fitWindow по сути
 * выполняет no-op (высота уже равна вьюпорту). Это НЕ баг этого модуля —
 * авто-подгонка под контент и фиксированный вьюпорт взаимоисключающи.
 *
 * Поэтому здесь НЕТ всегда-включённого MutationObserver (он давал бы лишние
 * вызовы и риск осцилляции высоты, ничего при этом не подгоняя). Вместо этого
 * fitWindow вызывается точечно в ключевых точках жизненного цикла. Если макет
 * когда-нибудь станет «растущим под контент» (убраны 100vh/overflow:hidden),
 * эти же вызовы начнут корректно подгонять высоту без изменений здесь.
 *
 * Вне iframe Битрикс24 (dev/standalone/прототип, webhook-shim из
 * assets/webhook-client.js — он НЕ реализует fitWindow) все вызовы безопасно
 * превращаются в no-op.
 */

// Дебаунс: при серии изменений высоты подряд порталу уходит один вызов.
const DEBOUNCE_MS = 150;

let _debounceTimer = null;

/**
 * _bx24FitAvailable() — true только при настоящем SDK с методом fitWindow.
 * Заодно отсекает dev/standalone (webhook-shim метод не реализует).
 */
function _bx24FitAvailable() {
  return typeof window !== 'undefined' &&
    window.BX24 &&
    typeof window.BX24.fitWindow === 'function';
}

/**
 * fitWindowNow — немедленно (без дебаунса) просит портал подогнать высоту фрейма.
 * Вне iframe портала — тихий no-op (с вызовом callback для совместимости).
 *
 * @param {Function} [callback] — необязательный колбэк, прокидывается в
 *        BX24.fitWindow (по SDK вызывается после отправки команды порталу).
 * @returns {boolean} true, если команда реально отправлена в SDK; иначе false.
 */
export function fitWindowNow(callback) {
  if (!_bx24FitAvailable()) {
    if (typeof callback === 'function') callback();
    return false;
  }
  try {
    window.BX24.fitWindow(typeof callback === 'function' ? callback : undefined);
    return true;
  } catch (e) {
    // fitWindow не должна влиять на работу приложения — глушим любые сбои SDK.
    console.warn('fitWindow: не удалось подогнать высоту фрейма', e);
    return false;
  }
}

/**
 * fitWindow — дебаунсированная версия fitWindowNow. Использовать по умолчанию
 * в точках, где высота контента могла измениться.
 *
 * @param {Function} [callback] — прокидывается в SDK-вызов после дебаунса.
 */
export function fitWindow(callback) {
  if (!_bx24FitAvailable()) {
    if (typeof callback === 'function') callback();
    return;
  }
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(function () {
    _debounceTimer = null;
    fitWindowNow(callback);
  }, DEBOUNCE_MS);
}
