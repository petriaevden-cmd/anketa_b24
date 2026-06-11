/**
 * form-render.js — рендер HTML-полей формы (Tailwind + Flowbite).
 *
 * v5-latest: поля приведены к дизайну прототипа v10.
 * Добавлена функция fieldRadio() для кнопок Да/Нет.
 * Стили полей: p-2.5, rounded-lg, text-sm, метки text-sm font-medium text-gray-700.
 *
 * Содержит escHtml() и функции fieldText/fieldNumber/fieldSelect/fieldTextarea/
 * fieldCheckbox/fieldRadio/fieldCity, которые возвращают строки HTML-разметки.
 * Также экспортирует константы OPTS_* — варианты для enumeration-полей.
 *
 * Файл является ES-модулем: ничего не делает с DOM, только производит строки.
 *
 * Поля анкеты (по прототипу v10):
 *
 * БЛОК 1 — Обращение: Фамилия, Имя, Отчество
 * БЛОК 2 — Долг: Сумма долга, Кредиторы, Несписываемый долг
 * БЛОК 3 — Просрочки/приставы: Просрочки, ФССП, Удержания с дохода
 * БЛОК 4 — Доход и работа: Офиц. доход, Неофиц. доход, Зарп. карта, incomeKmBad
 * БЛОК 5 — Ипотека и залог: Ипотека + уточнения, Залог + уточнения
 * БЛОК 6 — Имущество и сделки: Имущество + уточнения, Сделки + уточнения
 * БЛОК 7 — Семья: Семейное положение, Дети, Совм. имущество + уточнения
 * БЛОК 8 — Юрлица: ООО + уточнения, ИП
 * БЛОК 9 — Прочие стоп-факторы: За другого, Другая компания в АС, Судимость + уточнения
 * БЛОК 10 — Запись: Канал связи, Комментарий к записи
 * ИТОГ — Статус целевой/нецелевой
 */

'use strict';

// === Хелперы маски тысячных разрядов для денежных полей ===

/**
 * _digitsOnly — вернёт только цифры из value.
 */
export function _digitsOnly(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\D+/g, '');
}

/**
 * _formatMoneyDisplay — «60000» → «60 000» (U+202F как разделитель).
 */
export function _formatMoneyDisplay(v) {
  const d = _digitsOnly(v);
  if (!d) return '';
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
}

/**
 * attachMoneyMask — навешивает маску тысячных разрядов на поля data-money="1".
 */
export function attachMoneyMask(root) {
  const scope = root || document;
  const fields = scope.querySelectorAll('input[data-money="1"]');
  fields.forEach(function (el) {
    if (el.dataset.__moneyMaskBound === '1') return;
    el.dataset.__moneyMaskBound = '1';

    function onInput() {
      const selStart = el.selectionStart || 0;
      const digitsBeforeCursor = (el.value.slice(0, selStart).match(/\d/g) || []).length;
      const raw = _digitsOnly(el.value);
      el.dataset.raw = raw;
      el.value = _formatMoneyDisplay(raw);
      let pos = el.value.length;
      let cnt = 0;
      for (let i = 0; i < el.value.length; i++) {
        if (/\d/.test(el.value[i])) {
          cnt++;
          if (cnt === digitsBeforeCursor) { pos = i + 1; break; }
        }
      }
      try { el.setSelectionRange(pos, pos); } catch (_) { /* noop */ }
    }

    el.addEventListener('input', onInput);
    el.addEventListener('blur',  onInput);
  });
}

// ─── Компоненты полей формы (дизайн прототипа v10) ───────────────────────────
//
// Стили соответствуют прототипу:
//   - Метка:  text-sm font-medium text-gray-700 dark:text-gray-300
//   - Input:  bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg
//             focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5
//   - Select: те же классы

/**
 * fieldText — однострочное текстовое поле.
 */
export function fieldText(id, label, value, opts) {
  opts = opts || {};
  const span = opts.colSpan ? 'sm:col-span-2' : '';
  return `
    <div class="flex flex-col gap-1 ${span}">
      <label for="${id}" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${label}${opts.required ? '<span class="text-red-500 ml-0.5">*</span>' : ''}</label>
      <input id="${id}" name="${id}" type="text"
             value="${escHtml(value || '')}"
             ${opts.readonly ? 'readonly' : ''}
             ${opts.placeholder ? `placeholder="${escHtml(opts.placeholder)}"` : ''}
             class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg
                    focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5
                    dark:bg-gray-700 dark:border-gray-600 dark:text-white
                    ${opts.readonly ? 'cursor-default' : ''}
                    disabled:opacity-50"
             autocomplete="off">
      ${opts.hint ? `<p class="text-xs text-gray-400 dark:text-gray-500">${escHtml(opts.hint)}</p>` : ''}
    </div>`;
}

/**
 * fieldNumber — числовое поле с маской тысяч.
 */
export function fieldNumber(id, label, value, opts) {
  opts = opts || {};
  const span = opts.colSpan ? 'sm:col-span-2' : '';
  return `
    <div class="flex flex-col gap-1 ${span}">
      <label for="${id}" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${label}</label>
      <input id="${id}" name="${id}" type="text" inputmode="numeric" data-money="1"
             value="${escHtml(_formatMoneyDisplay(value))}"
             data-raw="${escHtml(_digitsOnly(value))}"
             ${opts.placeholder ? `placeholder="${escHtml(opts.placeholder)}"` : ''}
             class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg
                    focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5
                    dark:bg-gray-700 dark:border-gray-600 dark:text-white"
             autocomplete="off">
      ${opts.hint ? `<p class="text-xs text-gray-400 dark:text-gray-500">${escHtml(opts.hint)}</p>` : ''}
    </div>`;
}

/**
 * fieldSelect — выпадающий список.
 */
export function fieldSelect(id, label, value, options, opts) {
  opts = opts || {};
  const span = opts.colSpan ? 'sm:col-span-2' : '';
  const optHtml = options.map(function(o) {
    const selected = String(o.value) === String(value || '') ? 'selected' : '';
    return `<option value="${escHtml(String(o.value))}" ${selected}>${escHtml(o.label)}</option>`;
  }).join('');
  return `
    <div class="flex flex-col gap-1 ${span}">
      <label for="${id}" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${label}</label>
      <select id="${id}" name="${id}"
              class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg
                     focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5
                     dark:bg-gray-700 dark:border-gray-600 dark:text-white">
        <option value="">— Не указано —</option>
        ${optHtml}
      </select>
    </div>`;
}

/**
 * fieldTextarea — многострочное текстовое поле.
 */
export function fieldTextarea(id, label, value, opts) {
  opts = opts || {};
  const span = opts.colSpan ? 'sm:col-span-2' : '';
  return `
    <div class="flex flex-col gap-1 ${span}">
      <label for="${id}" class="block text-sm font-medium text-gray-700 dark:text-gray-300">${label}</label>
      <textarea id="${id}" name="${id}" rows="${opts.rows || 2}"
                ${opts.placeholder ? `placeholder="${escHtml(opts.placeholder)}"` : ''}
                class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg
                       focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5
                       dark:bg-gray-700 dark:border-gray-600 dark:text-white resize-none">${escHtml(value || '')}</textarea>
    </div>`;
}

/**
 * fieldRadio — группа кнопок Да/Нет (radio-переключатели в стиле прототипа v10).
 *
 * Каждая кнопка — невидимый <input type="radio"> + видимый <span> с peer-checked.
 * При выборе «Да» или «Нет» фон кнопки меняется на синий (или красный для «стоп»).
 *
 * @param {string} name        — name атрибут группы radio (уникальный в форме)
 * @param {string} label       — вопрос над кнопками
 * @param {string} currentVal  — текущее значение ('Y'/'N' или '')
 * @param {object} opts        — дополнительные опции:
 *   opts.yesRed  {bool}   — кнопка «Да» красная (стоп-фактор)
 *   opts.noRed   {bool}   — кнопка «Нет» красная
 *   opts.toggle  {string} — id блока, который показывается при Да (data-toggle)
 *   opts.labelClass {str} — дополнительный класс для метки (например text-gray-600)
 *   opts.small   {bool}   — уменьшенные кнопки (p-2 вместо p-2.5, для вложенных блоков)
 *   opts.colSpan {bool}   — растянуть на всю ширину родительской сетки
 */
export function fieldRadio(name, label, currentVal, opts) {
  opts = opts || {};
  const pad = opts.small ? 'p-2' : 'p-2.5';
  const labelCls = opts.labelClass || 'text-sm font-medium text-gray-700 dark:text-gray-300';
  const span = opts.colSpan ? 'sm:col-span-2' : '';

  const yesCheckedCls = opts.yesRed
    ? 'peer-checked:bg-red-600 peer-checked:text-white peer-checked:border-red-600'
    : 'peer-checked:bg-blue-600 peer-checked:text-white peer-checked:border-blue-600';
  const noCheckedCls = opts.noRed
    ? 'peer-checked:bg-red-600 peer-checked:text-white peer-checked:border-red-600'
    : 'peer-checked:bg-blue-600 peer-checked:text-white peer-checked:border-blue-600';

  const toggleAttr = opts.toggle ? `data-toggle="${escHtml(opts.toggle)}"` : '';

  const yesChecked  = currentVal === 'Y' ? 'checked' : '';
  const noChecked   = currentVal === 'N' ? 'checked' : '';

  return `
    <div class="${span}">
      <span class="block mb-2 ${labelCls}">${label}</span>
      <div class="flex gap-2">
        <label class="relative flex-1">
          <input type="radio" name="${escHtml(name)}" value="Y" ${yesChecked} ${toggleAttr} class="sr-only peer">
          <span class="flex items-center justify-center w-full ${pad} text-sm rounded-lg border border-gray-300 cursor-pointer ${yesCheckedCls} dark:border-gray-600">Да</span>
        </label>
        <label class="relative flex-1">
          <input type="radio" name="${escHtml(name)}" value="N" ${noChecked} ${toggleAttr} class="sr-only peer">
          <span class="flex items-center justify-center w-full ${pad} text-sm rounded-lg border border-gray-300 cursor-pointer ${noCheckedCls} dark:border-gray-600">Нет</span>
        </label>
      </div>
    </div>`;
}

/**
 * fieldCheckbox — одиночный чек-бокс.
 * Сохраняется для блока «Признаки нецелевой» и возможного использования.
 */
export function fieldCheckbox(id, label, checked, opts) {
  opts = opts || {};
  const isOn = (checked === true || checked === 'Y' || checked === 1 || checked === '1');
  const span = opts.colSpan ? 'col-span-2' : '';
  const hintHtml = opts.hint
    ? `<p class="ms-6 text-xs text-gray-400 leading-tight">${escHtml(opts.hint)}</p>`
    : '';
  return `
    <div class="flex flex-col gap-0.5 ${span}">
      <div class="flex items-center">
        <input id="${id}" name="${id}" type="checkbox"${isOn ? ' checked' : ''}
               class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-2 focus:ring-blue-500
                      dark:bg-gray-700 dark:border-gray-600">
        <label for="${id}" class="ms-2 text-sm text-gray-700 dark:text-gray-300 leading-tight">${label}</label>
      </div>
      ${hintHtml}
    </div>`;
}

/**
 * fieldCity — поле города с автодополнением и привязкой к TZ.
 */
export function fieldCity(id, label, value) {
  const citySource = (typeof CITIES_TZ !== 'undefined') ? CITIES_TZ : {};
  const opts = Object.keys(citySource).map(function(c) {
    return `<option value="${escHtml(c)}">`;
  }).join('');

  return `
    <div class="flex flex-col gap-1">
      <label for="${id}" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
        ${label}
        <span class="text-red-500 ml-0.5" title="Обязательное поле">*</span>
        <span class="text-blue-400 font-normal ml-1" title="Часовой пояс">→ TZ</span>
      </label>
      <input id="${id}" name="${id}" type="text" list="city-list"
             value="${escHtml(value || '')}"
             placeholder="Город..."
             autocomplete="off"
             required
             class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg
                    focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5
                    dark:bg-gray-700 dark:border-gray-600 dark:text-white">
      <datalist id="city-list">${opts}</datalist>
      <p id="${id}-error" class="hidden text-xs text-red-500">Укажите город клиента</p>
      <p id="${id}-tz-warn" class="hidden text-xs text-amber-500">Город не найден в справочнике</p>
    </div>`;
}

/**
 * escHtml — экранирует специальные HTML-символы в строке.
 */
export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Опции для enumeration-полей ────────────────────────────────────────────

export const OPTS_YES_NO = [
  { value: 'Y', label: 'Да' },
  { value: 'N', label: 'Нет' }
];

export const OPTS_SALARY_CARD = [
  { value: 'sber',  label: 'Сбербанк' },
  { value: 'other', label: 'Другой банк' },
  { value: 'none',  label: 'Нет' }
];

export const OPTS_MARITAL = [
  { value: 'single',   label: 'Не в браке' },
  { value: 'married',  label: 'В браке' },
  { value: 'divorced', label: 'Разведён/а' },
  { value: 'widow',    label: 'Вдовец/вдова' }
];

export const OPTS_CHILDREN = [
  { value: '0', label: 'Нет' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3+' }
];

// Опции канала связи (секция 10 — Запись)
export const OPTS_CHANNEL = [
  { value: '4280', label: 'WhatsApp' },
  { value: '4281', label: 'Telegram' },
  { value: '4340', label: 'Max (мессенджер)' },
  { value: '5424', label: 'SMS' },
  { value: '5442', label: 'Не отправлять' }
];
