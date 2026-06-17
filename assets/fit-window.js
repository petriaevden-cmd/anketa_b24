/**
 * fit-window.js — авто-подгонка высоты фрейма приложения под контент.
 *
 * Обёртка над BX24.fitWindow из официального SDK Битрикс24:
 *   https://apidocs.bitrix24.ru/sdk/bx24-js-sdk/additional-functions/bx24-fit-window.html
 *
 * BX24.fitWindow() отправляет порталу команду изменить высоту iframe приложения
 * под высоту контента (внутри использует BX24.getScrollSize().scrollHeight).
 * Вызывать её имеет смысл только в реальном iframe Битрикс24 — на standalone /
 * прототипе / в dev-режиме (webhook-shim) функции BX24.fitWindow нет, поэтому
 * все вызовы здесь безопасно превращаются в no-op и НИЧЕГО не ломают.
 *
 * Высота контента меняется во многих местах (рендер формы, показ/скрытие
 * уточняющих блоков, панель бронирования и слоты, сообщения валидации, статус
 * сохранения). Чтобы не расставлять вызовы вручную в каждом из них, помимо
 * явной функции fitWindow() здесь есть startFitWindowObserver(): он вешает
 * MutationObserver на корневой контейнер и сам дёргает (дебаунсированный)
 * fitWindow при любом изменении DOM/атрибутов.
 */

// Задержка дебаунса в мс. fitWindow дешёвая, но при пакетных изменениях DOM
// (рендер всей формы за один тик) разумно схлопнуть серию вызовов в один.
const DEBOUNCE_MS = 150;

let _debounceTimer = null;
let _observer = null;

/**
 * _bx24FitAvailable() — true только если доступен настоящий SDK с fitWindow.
 * Webhook-shim (assets/webhook-client.js) метод не реализует, поэтому проверка
 * заодно отсекает dev/standalone-режим.
 */
function _bx24FitAvailable() {
  return typeof window !== 'undefined' &&
    window.BX24 &&
    typeof window.BX24.fitWindow === 'function';
}

/**
 * fitWindowNow — немедленно (без дебаунса) просит портал подогнать высоту фрейма.
 * Вне iframe Битрикс24 — тихий no-op.
 *
 * @param {Function} [callback] — необязательный колбэк, прокидывается в
 *        BX24.fitWindow (по SDK вызывается после отправки команды порталу).
 */
export function fitWindowNow(callback) {
  if (!_bx24FitAvailable()) {
    // Не в iframe портала (dev/standalone) — подгонять нечего.
    if (typeof callback === 'function') callback();
    return;
  }
  try {
    window.BX24.fitWindow(typeof callback === 'function' ? callback : undefined);
  } catch (e) {
    // fitWindow не должна влиять на работу приложения — глушим любые сбои SDK.
    console.warn('fitWindow: не удалось подогнать высоту фрейма', e);
  }
}

/**
 * fitWindow — дебаунсированная версия fitWindowNow. Использовать по умолчанию:
 * при серии изменений высоты подряд порталу уйдёт один вызов, а не десяток.
 */
export function fitWindow() {
  if (!_bx24FitAvailable()) return; // дешёвый ранний выход вне портала
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(function () {
    _debounceTimer = null;
    fitWindowNow();
  }, DEBOUNCE_MS);
}

/**
 * startFitWindowObserver — автоматически вызывает fitWindow() при любом
 * изменении контента внутри root (добавление/удаление узлов, показ/скрытие
 * блоков через классы, рендер слотов и т.д.).
 *
 * Идемпотентна: повторный вызов не плодит наблюдателей.
 * Вне iframe Битрикс24 наблюдатель не вешается (подгонять всё равно нечего).
 *
 * @param {string} [rootId='app'] — id корневого контейнера приложения.
 */
export function startFitWindowObserver(rootId = 'app') {
  if (_observer) return;               // уже запущен
  if (!_bx24FitAvailable()) return;    // dev/standalone — наблюдатель не нужен
  if (typeof MutationObserver === 'undefined') return;

  const root = document.getElementById(rootId) || document.body;
  if (!root) return;

  _observer = new MutationObserver(function () {
    // Любая мутация → дебаунсированный запрос на подгонку высоты.
    fitWindow();
  });

  _observer.observe(root, {
    childList: true,    // добавление/удаление блоков (рендер формы, слотов, панели)
    subtree: true,      // во всей вложенности
    attributes: true,   // показ/скрытие через class="hidden", style и пр.
    attributeFilter: ['class', 'style']
  });

  // Первичная подгонка после старта наблюдателя.
  fitWindow();
}

/**
 * stopFitWindowObserver — снимает наблюдатель (на случай переинициализации).
 */
export function stopFitWindowObserver() {
  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }
}
