/**
 * admin.js — клиентская логика админ-панели анкеты.
 *
 * Один IIFE без сборки/фреймворков. На входе — окно с #search-form, #lead-list,
 * #editor и шаблонами <template id="tpl-field-...">.
 *
 * Стейт:
 *   - meta.fields      — карта UF-полей из admin-config.php (через admin-api.php)
 *   - state.leads      — текущий список лидов в сайдбаре
 *   - state.currentLead — загруженный лид (ID + snapshot полей)
 *   - state.edits      — { fieldCode: newValue, ... } — что изменил админ
 *
 * Поток:
 *   1. init() → fetch('?action=meta')
 *   2. search() → fetch('?action=search&q=...') → renderLeadList()
 *   3. selectLead(id) → fetch('?action=get&id=' + id) → renderEditor()
 *   4. save() → fetch POST '?action=save' → обновить state, лог, локально подсветить
 */

(() => {
  'use strict';

  // ─── Состояние ───────────────────────────────────────────────────────────
  const state = {
    fields: {},
    hidden: [],
    leads: [],
    currentLeadId: null,
    currentLead: null,
    edits: {}, // { fieldCode: newValue }
    initialLead: null, // snapshot лида на момент открытия (для revert)
    searchMode: 'recent',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ─── HTTP ────────────────────────────────────────────────────────────────
  // API живёт в отдельном файле admin-api.php рядом с admin.php.
  // Относительный путь — чтобы одинаково работало и с /anketa/, и с
  // /yurclick/anketa-kc/, и с любого подпути.
  const API_URL = (() => {
    const here = new URL(window.location.href);
    here.pathname = here.pathname.replace(/\/admin\.php$/, '/admin-api.php');
    here.search = '';
    here.hash = '';
    return here.toString();
  })();

  async function api(action, opts = {}) {
    const url = new URL(API_URL);
    url.searchParams.set('action', action);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        url.searchParams.set(k, v);
      }
    }
    const init = { method: 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) {
      init.method = 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const r = await fetch(url.toString(), init);
    let data;
    try { data = await r.json(); }
    catch { throw new Error(`HTTP ${r.status}: сервер вернул не-JSON (проверь что admin-api.php доступен)`); }
    if (!data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }

  // ─── Утилиты ─────────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  function moneyToHuman(value) {
    // Из B24 приходит "12345|RUB". Показываем как "12 345 ₽".
    if (value == null || value === '') return '';
    const digits = String(value).replace(/\D+/g, '');
    if (!digits) return '';
    return Number(digits).toLocaleString('ru-RU') + ' ₽';
  }
  function moneyToInput(value) {
    if (value == null || value === '') return '';
    const digits = String(value).replace(/\D+/g, '');
    if (!digits) return '';
    return Number(digits).toLocaleString('ru-RU');
  }
  function moneyToApi(input) {
    if (input == null || input === '') return '';
    return String(input).replace(/\D+/g, '');
  }

  function enumDisplay(value, options) {
    if (value === null || value === undefined || value === '') return '—';
    if (options && options[value] !== undefined) return String(options[value]);
    return String(value);
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return String(iso); }
  }
  function isoToLocalInput(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
  }
  function localInputToIso(local) {
    if (!local) return '';
    // "2026-06-18T12:30" → отдаём как есть; Битрикс ожидает ISO с TZ.
    // Чтобы не уплывало в чужой часовой пояс, добавляем явный офсет.
    const d = new Date(local);
    if (isNaN(d.getTime())) return local;
    return d.toISOString();
  }

  function leadFullName(lead) {
    return [lead.LAST_NAME, lead.NAME, lead.SECOND_NAME].filter(Boolean).join(' ').trim()
        || lead.NAME || '(без имени)';
  }

  // ─── Рендер списка лидов ────────────────────────────────────────────────
  function renderLeadList() {
    const list = $('#lead-list');
    list.innerHTML = '';

    if (!state.leads.length) {
      list.innerHTML = '<p class="p-4 text-xs text-gray-400 text-center">Ничего не найдено</p>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const lead of state.leads) {
      const div = document.createElement('div');
      div.className = 'px-3 py-2.5 border-b border-gray-100 cursor-pointer hover:bg-blue-50 transition-colors';
      if (state.currentLeadId && Number(lead.ID) === Number(state.currentLeadId)) {
        div.classList.add('bg-blue-50', 'border-l-4', 'border-l-blue-500');
      }
      div.innerHTML = `
        <div class="flex items-baseline justify-between gap-2">
          <div class="font-medium text-sm text-gray-900 truncate">${escapeHtml(leadFullName(lead))}</div>
          <div class="text-[11px] text-gray-400 shrink-0">#${escapeHtml(lead.ID)}</div>
        </div>
        <div class="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500 truncate">
          ${lead.STATUS_ID ? `<span class="px-1.5 py-0.5 rounded bg-gray-100">${escapeHtml(lead.STATUS_ID)}</span>` : ''}
          ${lead.PHONE ? `<span class="truncate">${escapeHtml(Array.isArray(lead.PHONE) ? lead.PHONE.join(', ') : lead.PHONE)}</span>` : ''}
        </div>
        <div class="text-[11px] text-gray-400 mt-0.5">${formatDateTime(lead.DATE_MODIFY)}</div>
      `;
      div.addEventListener('click', () => selectLead(lead.ID));
      frag.appendChild(div);
    }
    list.appendChild(frag);
  }

  // ─── Поиск ──────────────────────────────────────────────────────────────
  async function search(q) {
    const status = $('#search-mode');
    status.textContent = 'Ищу...';
    try {
      const r = await api('search', { query: { q: q || '', limit: '20' } });
      state.leads = r.items || [];
      state.searchMode = r.mode;
      if (r.mode === 'recent' && !q) {
        status.textContent = 'Показаны последние изменённые лиды';
      } else {
        status.textContent = r.mode === 'search'
          ? `Найдено ${r.total ?? state.leads.length} лидов`
          : 'Показаны последние изменённые лиды';
      }
      renderLeadList();
    } catch (e) {
      status.textContent = 'Ошибка: ' + e.message;
    }
  }

  // ─── Загрузка лида в редактор ──────────────────────────────────────────
  async function selectLead(id) {
    state.currentLeadId = id;
    state.edits = {};
    renderLeadList();
    $('#empty-state').classList.add('hidden');
    $('#editor').classList.remove('hidden');
    $('#editor').classList.add('flex');
    $('#lead-header').innerHTML = '<p class="text-xs text-gray-400">Загружаю лид...</p>';
    $('#fields-area').innerHTML = '';
    $('#log-list').innerHTML = '';
    setDirtyBadge();

    try {
      const r = await api('get', { query: { id: String(id) } });
      state.currentLead = r.lead;
      state.initialLead = JSON.parse(JSON.stringify(r.lead)); // deep clone для revert
      renderLeadHeader(r.lead);
      renderFields(r.lead);
      renderLog(r.log || []);
    } catch (e) {
      $('#lead-header').innerHTML = '';
      $('#fields-area').innerHTML = `<p class="p-6 text-sm text-red-700">Ошибка загрузки: ${escapeHtml(e.message)}</p>`;
    }
  }

  // ─── Шапка лида ─────────────────────────────────────────────────────────
  function renderLeadHeader(lead) {
    const h = $('#lead-header');
    const status = lead.STATUS_ID || '—';
    const portalPath = getPortalLeadPath(lead.ID);
    h.innerHTML = `
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-base font-semibold text-gray-900 truncate">${escapeHtml(leadFullName(lead))}</h1>
          <div class="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span>Лид <span class="font-mono">#${escapeHtml(lead.ID)}</span></span>
            <span>·</span>
            <span>Статус: <span class="px-1.5 py-0.5 rounded bg-gray-100 font-medium">${escapeHtml(status)}</span></span>
            ${lead.ASSIGNED_BY_ID ? `<span>· Ответственный: <span class="font-mono">${escapeHtml(lead.ASSIGNED_BY_ID)}</span></span>` : ''}
            ${lead.PHONE ? `<span>· ${escapeHtml(Array.isArray(lead.PHONE) ? lead.PHONE.join(', ') : lead.PHONE)}</span>` : ''}
            <span>·</span>
            <span>Изменён: ${formatDateTime(lead.DATE_MODIFY)}</span>
          </div>
        </div>
        <div class="shrink-0 flex gap-2">
          ${portalPath ? `<a href="${portalPath}" target="_blank" rel="noopener noreferrer"
              class="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 hover:bg-gray-50">
              Открыть в CRM ↗</a>` : ''}
          <button type="button" id="btn-history"
                  class="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 hover:bg-gray-50">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Перечитать
          </button>
        </div>
      </div>
    `;
    $('#btn-history').addEventListener('click', () => {
      if (state.currentLeadId) selectLead(state.currentLeadId);
    });
  }

  function getPortalLeadPath(id) {
    // Не знаем точно схему/хост портала — оставим ссылку на стандартный путь.
    // Если у вас другой путь — поменяйте здесь.
    return `https://crm.yurclick.com/crm/lead/details/${id}/`;
  }

  // ─── Рендер полей ───────────────────────────────────────────────────────
  function renderFields(lead) {
    const area = $('#fields-area');
    area.innerHTML = '';

    // Группируем по group из meta.fields.
    const groups = {};
    for (const [code, meta] of Object.entries(state.fields)) {
      if (state.hidden.includes(code)) continue;
      const g = meta.group || 'Прочее';
      (groups[g] = groups[g] || []).push({ code, meta });
    }

    // Порядок групп (важные сверху).
    const groupOrder = [
      'Стандартные', 'Персональные', 'Финансы', 'Кредитная история',
      'Заметки менеджера', 'Запись на встречу', 'Целевой/Нецелевой',
      'Служебные', 'Прочее',
    ];
    const sortedGroups = Object.keys(groups).sort(
      (a, b) => groupOrder.indexOf(a) - groupOrder.indexOf(b)
    );

    const frag = document.createDocumentFragment();

    for (const g of sortedGroups) {
      const groupEl = document.createElement('section');
      groupEl.className = 'bg-white border-b border-gray-200';
      groupEl.innerHTML = `
        <div class="px-5 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
          <span class="text-xs font-semibold text-gray-700 uppercase tracking-wide">${escapeHtml(g)}</span>
          <span class="text-[11px] text-gray-400">${groups[g].length} ${pluralFields(groups[g].length)}</span>
        </div>
        <div class="px-5 py-2 divide-y divide-gray-100"></div>
      `;
      const inner = groupEl.querySelector('div.divide-y');
      for (const { code, meta } of groups[g]) {
        inner.appendChild(renderFieldRow(code, meta, lead[code]));
      }
      frag.appendChild(groupEl);
    }
    area.appendChild(frag);
  }

  function pluralFields(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'поле';
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'поля';
    return 'полей';
  }

  function renderFieldRow(code, meta, currentValue) {
    const isTextarea = meta.type === 'string' && (
      meta.label.includes('комментар') || meta.label.includes('боль') ||
      meta.label.includes('Возражен') || meta.label.includes('Исключен') ||
      meta.label.includes('кредитор') || meta.label.includes('Просроч')
    );
    const tplId = (() => {
      if (meta.type === 'readonly') return 'tpl-field-readonly';
      if (meta.type === 'money')    return 'tpl-field-money';
      if (meta.type === 'boolean')  return 'tpl-field-boolean';
      if (meta.type === 'enum')     return 'tpl-field-enum';
      if (meta.type === 'datetime') return 'tpl-field-datetime';
      if (isTextarea)               return 'tpl-field-textarea';
      return 'tpl-field-input';
    })();
    const tpl = $('#' + tplId);
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.fieldCode = code;
    node.dataset.fieldType = meta.type;

    // Метка и подсказка
    const labelEl = node.querySelector('label');
    if (labelEl) labelEl.textContent = meta.label;
    const hintEl = node.querySelector('p');
    if (hintEl) {
      const hintText = meta.hint || code;
      hintEl.textContent = hintText;
      hintEl.title = code; // полный код поля во всплывашке
    }

    const input = node.querySelector('[data-input]');
    const display = node.querySelector('[data-display]');
    const clearBtn = node.querySelector('[data-clear]');

    // Заполняем начальным значением
    if (meta.type === 'readonly') {
      display.textContent = formatReadonly(code, currentValue, meta);
    } else if (meta.type === 'money') {
      input.value = moneyToInput(currentValue);
    } else if (meta.type === 'boolean') {
      const v = (currentValue === '1' || currentValue === 1 || currentValue === true) ? 'Y'
              : (currentValue === '0' || currentValue === 0 || currentValue === false) ? 'N'
              : '';
      if (v) {
        const radio = input.querySelector(`input[value="${v}"]`);
        if (radio) radio.checked = true;
      }
    } else if (meta.type === 'enum') {
      // Заполняем select
      const sel = input;
      sel.innerHTML = '<option value="">— не указано —</option>';
      for (const [val, lbl] of Object.entries(meta.options || {})) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = String(lbl);
        sel.appendChild(opt);
      }
      sel.value = currentValue == null ? '' : String(currentValue);
    } else if (meta.type === 'datetime') {
      input.value = isoToLocalInput(currentValue);
    } else {
      input.value = currentValue == null ? '' : String(currentValue);
    }

    // Слушатели изменений (помечают поле как dirty)
    if (input) {
      input.addEventListener('input', () => onFieldEdit(code, meta, node));
      input.addEventListener('change', () => onFieldEdit(code, meta, node));
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        $$('input[type="radio"]', node).forEach(r => r.checked = false);
        onFieldEdit(code, meta, node);
      });
    }

    return node;
  }

  function formatReadonly(code, value, meta) {
    if (!value) return '—';
    if (code === 'DATE_CREATE' || code === 'DATE_MODIFY') return formatDateTime(value);
    if (meta.options) return enumDisplay(value, meta.options);
    return String(value);
  }

  // ─── Dirty-логика ───────────────────────────────────────────────────────
  function onFieldEdit(code, meta, rowNode) {
    const input = rowNode.querySelector('[data-input]');
    let newValue;
    if (meta.type === 'money') {
      newValue = moneyToApi(input.value);
    } else if (meta.type === 'boolean') {
      const r = rowNode.querySelector('input[type="radio"]:checked');
      newValue = r ? r.value : '';
    } else if (meta.type === 'datetime') {
      newValue = input.value ? localInputToIso(input.value) : '';
    } else {
      newValue = input.value;
    }

    const origValue = state.initialLead ? state.initialLead[code] : null;
    const origApi = apiValue(origValue, meta);
    if (String(newValue) === String(origApi)) {
      delete state.edits[code];
      rowNode.classList.remove('is-dirty');
    } else {
      state.edits[code] = newValue;
      rowNode.classList.add('is-dirty');
    }
    setDirtyBadge();
  }

  function apiValue(value, meta) {
    if (value == null) return '';
    if (meta.type === 'money') {
      return moneyToApi(value); // '12345' → нормализуем к API
    }
    if (meta.type === 'datetime') {
      return isoToLocalInput(value);
    }
    return String(value);
  }

  function setDirtyBadge() {
    const n = Object.keys(state.edits).length;
    $('#dirty-badge').classList.toggle('hidden', n === 0);
    $('#dirty-badge').lastChild.textContent = ` ${n} ${pluralFields(n)}`;
    $('#btn-save').disabled = n === 0;
    $('#btn-revert').disabled = n === 0;
  }

  // ─── Сохранение ─────────────────────────────────────────────────────────
  async function save() {
    const edits = Object.entries(state.edits);
    if (!edits.length) return;
    const btn = $('#btn-save');
    const status = $('#save-status');
    btn.disabled = true;
    status.textContent = 'Сохраняю...';
    try {
      const r = await api('save', {
        body: { id: state.currentLeadId, fields: state.edits },
      });
      status.textContent = `Сохранено: ${r.changed} ${pluralFields(r.changed)}`;
      status.classList.add('text-emerald-700');
      setTimeout(() => status.classList.remove('text-emerald-700'), 2500);

      // Обновляем стейт: снимаем подсветку, перезаписываем initialLead.
      state.edits = {};
      if (r.lead) {
        state.currentLead = r.lead;
        state.initialLead = JSON.parse(JSON.stringify(r.lead));
      }
      // Перерисовываем поля, чтобы снять dirty-классы и обновить значения.
      renderFields(state.currentLead);
      renderLog(r.log || []);
      renderLeadHeader(state.currentLead);
      setDirtyBadge();
    } catch (e) {
      status.textContent = 'Ошибка: ' + e.message;
      status.classList.add('text-red-700');
      setTimeout(() => status.classList.remove('text-red-700'), 3500);
    } finally {
      btn.disabled = Object.keys(state.edits).length === 0;
    }
  }

  // ─── История ────────────────────────────────────────────────────────────
  function renderLog(entries) {
    const list = $('#log-list');
    $('#log-count').textContent = entries.length ? `(${entries.length})` : '';
    if (!entries.length) {
      list.innerHTML = '<p class="text-xs text-gray-400 py-3">Пока никто не правил этот лид через админку.</p>';
      return;
    }
    list.innerHTML = entries.map(e => {
      const oldStr = e.old == null ? '∅' : String(e.old);
      const newStr = e.new == null ? '∅' : String(e.new);
      const label = (state.fields[e.field]?.label) || e.field;
      return `
        <div class="py-2 border-b border-gray-100 last:border-0">
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-xs font-medium text-gray-800">${escapeHtml(label)}</span>
            <span class="text-[11px] text-gray-400 shrink-0">${escapeHtml(formatDateTime(e.ts))} · ${escapeHtml(e.user || '?')}</span>
          </div>
          <div class="mt-0.5 text-[11px] font-mono text-gray-600 break-all">
            <span class="text-red-600 line-through">${escapeHtml(oldStr)}</span>
            <span class="text-gray-400 mx-1">→</span>
            <span class="text-emerald-700">${escapeHtml(newStr)}</span>
          </div>
          <div class="text-[10px] text-gray-400 font-mono mt-0.5">${escapeHtml(e.field)}</div>
        </div>
      `;
    }).join('');
  }

  // ─── Кнопки ─────────────────────────────────────────────────────────────
  function bindToolbar() {
    $('#btn-save').addEventListener('click', save);
    $('#btn-reload').addEventListener('click', () => {
      if (state.currentLeadId) selectLead(state.currentLeadId);
    });
    $('#btn-revert').addEventListener('click', () => {
      if (!state.currentLeadId || !state.initialLead) return;
      state.edits = {};
      renderFields(state.initialLead);
      setDirtyBadge();
    });

    $('#search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('#search-q').value.trim();
      search(q);
    });

    // Хоткеи: Ctrl+S = сохранить.
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!btn_s.disabled) save();
      }
    });
  }
  const btn_s = { get disabled() { return $('#btn-save').disabled; } };

  // ─── Init ───────────────────────────────────────────────────────────────
  async function init() {
    bindToolbar();
    try {
      const r = await api('meta');
      state.fields = r.fields;
      state.hidden = r.hidden;
    } catch (e) {
      alert('Не удалось получить карту полей: ' + e.message);
      return;
    }
    // Стартовый список — последние изменённые лиды.
    await search('');
  }

  // Запускаем после готовности DOM (мы в конце body — можно сразу).
  init();
})();
