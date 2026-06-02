/**
 * webhook-client.js — клиент для работы с Битрикс24 через входящий вебхук.
 *
 * НАЗНАЧЕНИЕ (режим разработки / тестирования вне iframe Bitrix24):
 *   Этот файл позволяет запускать приложение в ЛЮБОМ браузере (не только внутри
 *   iframe Битрикс24), делая вызовы REST API напрямую через входящий вебхук.
 *
 *   Старый код (app.js, form.js, calendar.js) использует BX24.callMethod/callBatch.
 *   Чтобы не переписывать весь код, мы создаём shim-объект window.BX24 с теми же
 *   методами, которые внутри делают fetch() на вебхук.
 *
 * РЕЖИМЫ РАБОТЫ (управляется флагом window.APP_USE_WEBHOOK из index.php):
 *   - APP_USE_WEBHOOK === true  → используется shim из этого файла (данные с вебхука).
 *   - APP_USE_WEBHOOK === false → используется оригинальный BX24 SDK (работа в iframe).
 *
 * ВНИМАНИЕ: Вебхук имеет скоупы только: bizproc, calendar, crm.
 *   Методы user.*, department.*, placement.* недоступны — для них возвращаем mock.
 *
 * ИСТОЧНИК URL ВЕБХУКА:
 *   Только window.APP_CONFIG.webhookUrl, который PHP формирует в config.php
 *   по карте доменов PORTAL_MAP (см. config.php). Никаких фронтовых
 *   эвристик по location.hostname здесь больше нет — это единый источник
 *   истины. Если APP_CONFIG.webhookUrl пуст — shim падает с явной ошибкой.
 *
 * ФОРМАТ ВОЗВРАТА (совместим с BX24 SDK):
 *   result.error()   → строка ошибки или пустая строка.
 *   result.data()    → payload (то, что лежит в JSON поле "result").
 *   result.answer    → полный ответ вебхука (result, error, time, next, total).
 *   result.total()   → общее число записей (для list-методов).
 *   result.more()    → true, если есть следующая страница.
 */

'use strict';

(function (global) {
  // ──────────────────────────────────────────────────────────────────────────
  // БЛОК 1: БАЗОВЫЕ НАСТРОЙКИ
  // ──────────────────────────────────────────────────────────────────────────

  // URL вебхука приходит ТОЛЬКО из window.APP_CONFIG.webhookUrl.
  // PHP в config.php выбирает его по карте доменов PORTAL_MAP и передаёт
  // во фронт через index.php. Никаких локальных фолбэков нет — это
  // единый источник истины, иначе легко получить расхождение.
  const WEBHOOK_URL = String(
    (global.APP_CONFIG && global.APP_CONFIG.webhookUrl) || ''
  ).replace(/\/+$/, '');

  if (!WEBHOOK_URL) {
    try {
      console.error(
        '[webhook-client] APP_CONFIG.webhookUrl пуст — вебхук не настроен в config.php.'
      );
    } catch (e) { /* no-op */ }
  } else if (global.APP_USE_WEBHOOK === true) {
    // Лог только когда shim реально активен — иначе в iframe вводит в заблуждение.
    try {
      console.info(
        '%c[webhook-client] Режим разработки: вызовы идут через вебхук',
        'background:#fde68a;color:#92400e;padding:2px 6px;border-radius:4px;font-weight:bold;',
        WEBHOOK_URL
      );
    } catch (e) { /* no-op */ }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // БЛОК 2: MOCK-ДАННЫЕ ДЛЯ НЕДОСТУПНЫХ ЧЕРЕЗ ВЕБХУК МЕТОДОВ
  // ──────────────────────────────────────────────────────────────────────────
  //
  // Вебхук имеет скоупы: bizproc, calendar, crm.
  // Методы типа user.current / user.get / department.get / placement.info
  // вернут 'insufficient_scope'. Поэтому для них возвращаем заранее подготовленные
  // значения, чтобы frontend мог корректно отрисоваться.
  //
  // Данные текущего пользователя берём из APP_CONFIG.currentUser — они передаются
  // из PHP (index.php) и отражают реального пользователя, открывшего приложение.
  // Если APP_CONFIG.currentUser не задан (например, при прямом открытии без сервера),
  // используем пустой фолбэк.
  //
  // Это ТОЛЬКО для режима разработки. В продуктиве (внутри iframe Битрикс24)
  // эти методы отрабатывают через настоящий BX24 SDK.

  const _configUser = (global.APP_CONFIG && global.APP_CONFIG.currentUser) || {};
  const MOCK_CURRENT_USER = {
    ID:          String(_configUser.ID        || '0'),
    NAME:        String(_configUser.NAME      || ''),
    LAST_NAME:   String(_configUser.LAST_NAME || ''),
    SECOND_NAME: '',
    EMAIL:       String(_configUser.EMAIL     || ''),
    ACTIVE:      true
  };

  // Получаем ID лида из URL-параметров (удобно для тестирования).
  // Поддерживаются три параметра, в порядке приоритета:
  //   1. clientID — именно так Bitrix24 прокидывает ID в URL карточки лида
  //      (?clientID=12826), то есть самый «живой» источник в реальном портале.
  //   2. leadID — явный вариант для ручных ссылок.
  //   3. leadId — старый легаси-вариант, сохранён для обратной совместимости.
  //
  // Раньше здесь был хардкод «реального» лида 59466, из-за чего при открытии
  // без параметра всегда показывался этот лид, а не тот, который ждёт пользователь.
  // Теперь возвращаем null, если ни один параметр не передан — placement.info()
  // отдаст options.ID === '', app.js покажет явную ошибку вместо молчаливого подмешивания.
  function _getLeadIdFromUrl() {
    try {
      const params = new URLSearchParams(global.location.search);
      const raw = params.get('clientID') || params.get('leadID') || params.get('leadId');
      const v = parseInt(raw, 10);
      return v > 0 ? v : null;
    } catch (e) {
      return null;
    }
  }

  const _devLeadId = _getLeadIdFromUrl();
  const MOCK_PLACEMENT = {
    placement: 'CRM_LEAD_DETAIL_TAB',
    options: { ID: _devLeadId !== null ? String(_devLeadId) : '' }
  };

  // ВАЖНО (anketa v3): Адаптер calendar.accessibility.get с парсингом названий
  // событий вида «МП N» и техническим пользователем MEETINGS_OWNER_ID=137 удалён.
  //
  // Новый поток в slots.js напрямую вызывает calendar.event.get с
  // type=MP[N]Vstrechi, ownerId=0 для каждого из 11 реальных календарей МП.
  // Номер МП определяется по календарю-источнику, без хрупкого regex по NAME.
  // См. anketa-kc/docs/tz.md и комментарии в slots.js.

  // ──────────────────────────────────────────────────────────────────────────
  // БЛОК 3: НИЗКОУРОВНЕВЫЙ ВЫЗОВ ВЕБХУКА (fetch)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * _rawCall(method, params) → Promise<answer>
   * Делает POST-запрос на <webhook>/<method>.json с JSON-телом params.
   * Возвращает «сырой» JSON-ответ вебхука: { result, error, time, next, total }.
   */
  function _rawCall(method, params) {
    const url = `${WEBHOOK_URL}/${method}.json`;
    const body = JSON.stringify(params || {});
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    }).then(function (resp) {
      return resp.json().catch(function () {
        return { error: 'invalid_json', error_description: 'Вебхук вернул не JSON' };
      });
    }).catch(function (e) {
      return { error: 'network_error', error_description: String(e && e.message || e) };
    });
  }

  /**
   * _wrapAnswer(answer) → объект, совместимый с BX24 SDK-результатом.
   * Возвращает { error(), data(), answer, total(), more() }.
   */
  function _wrapAnswer(answer) {
    answer = answer || {};
    return {
      answer: answer,
      error: function () {
        if (!answer.error) return '';
        // Битрикс24 возвращает error либо строкой, либо объектом {error, error_description}.
        return answer.error_description || answer.error || 'unknown_error';
      },
      data: function () {
        return answer.result;
      },
      total: function () {
        return answer.total || 0;
      },
      more: function () {
        return typeof answer.next !== 'undefined';
      }
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // БЛОК 4: ОБРАБОТКА СПЕЦИАЛЬНЫХ МЕТОДОВ (mock-проброс для user/department)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * _handleMethod(method, params) → Promise<answer>
   * Принимает имя метода и параметры, решает:
   *   - отдать mock (для недоступных через webhook методов user.* / department.*),
   *   - или пробросить как есть в вебхук (calendar.*, crm.*, bizproc.*).
   *
   * ВАЖНО (anketa v3): адаптер calendar.accessibility.get удалён.
   * Новый код в slots.js использует calendar.event.get с type=MP[N]Vstrechi
   * и определяет МП по календарю-источнику, а не по regex /МП\s*\d+/ в NAME.
   */
  function _handleMethod(method, params) {
    params = params || {};

    // user.current → mock (вебхук не имеет скоупа user).
    if (method === 'user.current') {
      return Promise.resolve({ result: MOCK_CURRENT_USER });
    }

    // user.get → mock с единственным пользователем (имитация поиска).
    if (method === 'user.get') {
      return Promise.resolve({ result: [MOCK_CURRENT_USER] });
    }

    // department.get → пустой список (для calendar.js при фильтрации отдела).
    if (method === 'department.get') {
      return Promise.resolve({ result: [] });
    }

    // Все остальные методы — пробрасываем как есть (crm.*, bizproc.*, calendar.*).
    return _rawCall(method, params);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // БЛОК 5: SHIM ОБЪЕКТА window.BX24 (совместимость со старым кодом)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * BX24_WEBHOOK_SHIM — объект с API, идентичным window.BX24 из SDK Битрикс24.
   * Используется, если global.APP_USE_WEBHOOK === true.
   */
  const BX24_WEBHOOK_SHIM = {
    /**
     * init(cb) — просто вызывает callback (в SDK он ждёт готовность iframe).
     */
    init: function (cb) {
      if (typeof cb === 'function') {
        // setTimeout — имитируем асинхронность, чтобы DOM успел инициализироваться.
        setTimeout(cb, 0);
      }
    },

    /**
     * placement.info() → { placement, options }
     * Возвращает mock с ID лида из ?leadId=...
     */
    placement: {
      info: function () { return MOCK_PLACEMENT; }
    },

    /**
     * callMethod(method, params, cb) — совместим с SDK.
     * cb получает объект с методами error() и data().
     */
    callMethod: function (method, params, cb) {
      _handleMethod(method, params).then(function (answer) {
        const wrapped = _wrapAnswer(answer);
        if (typeof cb === 'function') cb(wrapped);
      });
    },

    /**
     * callBatch(commands, cb) — вызывает методы и собирает их в объект
     * { key: wrappedResult, ... }, имитируя контракт BX24.callBatch из SDK.
     *
     * Реализовано через Promise.all, поэтому запросы фактически идут параллельно —
     * это не «сериализация», как могло бы показаться по старой формулировке.
     * Реальный endpoint /batch вебхука намеренно не используется: он требует
     * специфического формата `cmd[key]=method%3Fparams_urlencoded` и возвращает
     * результаты пачкой в одном теле — это усложнило бы парсинг и обработку
     * ошибок ради экономии нескольких HTTP-запросов. В dev-режиме скорость не
     * критична, а отдельные запросы проще логировать и переигрывать в DevTools.
     */
    callBatch: function (commands, cb) {
      const keys = Object.keys(commands || {});
      const promises = keys.map(function (key) {
        const pair = commands[key];
        // pair может быть массивом ['method', params] или объектом { method, params }.
        let method, params;
        if (Array.isArray(pair)) {
          method = pair[0];
          params = pair[1] || {};
        } else {
          method = pair.method;
          params = pair.params || {};
        }
        return _handleMethod(method, params).then(function (ans) {
          return { key: key, wrapped: _wrapAnswer(ans) };
        });
      });

      Promise.all(promises).then(function (arr) {
        const out = {};
        arr.forEach(function (item) { out[item.key] = item.wrapped; });
        if (typeof cb === 'function') cb(out);
      });
    },

    /**
     * installFinish() — no-op в режиме разработки.
     */
    installFinish: function () { /* no-op */ },

    /**
     * getAuth() → null — нет реальной авторизации через SDK.
     */
    getAuth: function () { return null; }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // БЛОК 6: АКТИВАЦИЯ SHIM (если включён режим вебхука)
  // ──────────────────────────────────────────────────────────────────────────

  if (global.APP_USE_WEBHOOK === true) {
    global.BX24 = BX24_WEBHOOK_SHIM;
    global.BX24_WEBHOOK = BX24_WEBHOOK_SHIM;
  }

})(typeof window !== 'undefined' ? window : this);
