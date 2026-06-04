/**
 * logger-client.js — отправляет события на logger.php для записи в logs.txt.
 *
 * Использование:
 *   import { logEvent } from './logger-client.js';
 *   logEvent('FORM_SAVED', { fieldsCount: 5 });
 *
 * Все события автоматически обогащаются:
 *   - leadId   из AppState ('leadId')
 *   - user     из AppState ('currentUsername')
 *   - env      из window.APP_CONFIG.appEnv
 */

import { AppState } from './app-state.js';

/**
 * logEvent(event, data)
 *
 * @param {string} event  — имя события, заглавными буквами через подчёркивание.
 *                          Примеры: APP_START, LEAD_LOADED, FORM_SAVED, FORM_ERROR,
 *                          BOOKING_SELECTED, BOOKING_CONFIRMED, FORM_RESET,
 *                          FIELD_CHANGED, SLOTS_LOADED, SLOTS_ERROR
 *
 * @param {object|null} data — произвольный объект с дополнительными данными.
 *                             Появляется в колонке data= в логе.
 *                             Передавай null, если лишних данных нет.
 */
export function logEvent(event, data) {
    // Берём данные из AppState — к моменту вызова он уже должен быть заполнен.
    // Если вызов происходит до инициализации (например, APP_START), вернётся 0 / '—'.
    const leadId = AppState.get('leadId') || 0;
    const user   = AppState.get('currentUsername') || '—';
    const env    = (window.APP_CONFIG && window.APP_CONFIG.appEnv) ? window.APP_CONFIG.appEnv : '?';

    const payload = { event, leadId, user, env };
    if (data !== null && data !== undefined) {
        payload.data = data;
    }

    // Определяем URL logger.php относительно текущего скрипта.
    // assets/logger-client.js лежит в /anketa/assets/, поэтому идём на уровень выше.
    const loggerUrl = (function () {
        // import.meta.url возвращает абсолютный URL текущего модуля.
        // Поднимаемся из assets/ в корень папки anketa.
        const base = new URL('..', import.meta.url).href;
        return base + 'logger.php';
    })();

    // Отправляем без ожидания ответа — не блокируем основной поток.
    // keepalive: true — браузер гарантирует доставку даже при закрытии страницы.
    fetch(loggerUrl, {
        method:    'POST',
        headers:   { 'Content-Type': 'application/json' },
        body:      JSON.stringify(payload),
        keepalive: true
    }).catch(function (err) {
        // Ошибка логирования не должна прерывать работу приложения.
        // Тихо выводим в консоль — не показываем пользователю.
        console.warn('[logger-client] не удалось отправить лог:', err);
    });
}
