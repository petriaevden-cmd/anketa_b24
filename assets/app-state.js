/**
 * app-state.js — единое хранилище состояния приложения.
 *
 * Все данные, которые нужны нескольким модулям одновременно,
 * хранятся здесь — чтобы зависимость была явной (импорт),
 * а не скрытой (чтение глобальной переменной).
 *
 * Модули ЧИТАЮТ данные через AppState.get('leadId').
 * Только app.js ЗАПИСЫВАЕТ данные через AppState.set('leadId', value)
 * и диспатчит событие, чтобы заинтересованные модули отреагировали.
 *
 * После задачи 4 это полноценный ES-модуль с export. window.AppState
 * также сохраняется на переходный период для непереведённых файлов
 * (target-status.js, mp-config.js, webhook-client.js — они не модули).
 */

const _state = {};

export const AppState = {
  set(key, value) {
    _state[key] = value;
    // CustomEvent на document — стандартный механизм оповещения подписчиков
    // без жёсткой связки модулей. Любой обработчик, навешанный на
    // document.addEventListener('appstate:change', ...), получит уведомление.
    document.dispatchEvent(new CustomEvent('appstate:change', {
      detail: { key, value }
    }));
  },
  get(key) {
    return _state[key];
  },
  on(key, callback) {
    // Подписка на изменение конкретного ключа: обработчик вызывается
    // только когда меняется именно этот key, а не любая запись AppState.
    document.addEventListener('appstate:change', (e) => {
      if (e.detail.key === key) callback(e.detail.value);
    });
  }
};

// Переходный bridge: target-status.js, mp-config.js, webhook-client.js
// ещё не ES-модули и обращаются к AppState через window. Полностью
// убрать window.AppState можно будет после рефакторинга и этих файлов.
if (typeof window !== 'undefined') {
  window.AppState = AppState;
}
