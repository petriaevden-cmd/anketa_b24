/**
 * form-init.js — инициализация формы данными лида.
 *
 * v5-latest: переработана под прототип v10.
 * Структура анкеты приведена к 10 разделам прототипа.
 * Все Да/Нет поля рендерятся как radio-переключатели через fieldRadio().
 * Скрытые уточняющие блоки работают через data-toggle (attachToggles).
 *
 * Зависит от form-render.js и target-status.js (window.TargetStatus).
 */

import {
  fieldText, fieldNumber, fieldSelect, fieldTextarea,
  fieldCheckbox, fieldRadio, fieldCity, escHtml, attachMoneyMask,
  OPTS_SALARY_CARD, OPTS_MARITAL, OPTS_CHILDREN, OPTS_CHANNEL
} from './form-render.js';
import { collectFormData, clearCityError } from './form-submit.js';
import { setClientCity } from './slots.js';

// ─── Утилиты ─────────────────────────────────────────────────────────────────

/**
 * _ynFromBx — конвертирует bitrix enum-id в 'Y'/'N'/'' для radio-переключателей.
 * Принимает значение из поля лида: если это 'Y'/'N' — возвращает как есть,
 * если число — проверяет по таблице известных enum.
 */
function _ynFromBx(val) {
  if (!val) return '';
  if (val === 'Y' || val === 'N') return val;
  // Поля с YN_ENUM хранят числовые ID: Y-вариант всегда нечётный (4755,4759,4761,4763,4746...)
  // Упрощённая эвристика: если enum-id нечётный — 'Y', чётный — 'N'.
  const n = parseInt(val, 10);
  if (!isNaN(n)) return n % 2 !== 0 ? 'Y' : 'N';
  return '';
}

// ─── Инициализация формы ─────────────────────────────────────────────────────

/**
 * initForm — главная функция инициализации формы данными лида.
 * Вызывается из app.js после загрузки данных лида.
 *
 * @param {object} lead — объект лида из Bitrix24 API.
 */
export function initForm(lead) {
  const f = lead;

  // ── БЛОК 1: Обращение ──────────────────────────────────────────────────────
  const sec1 = document.getElementById('section-1-body');
  if (sec1) {
    sec1.className = 'grid grid-cols-1 sm:grid-cols-3 gap-4';
    sec1.innerHTML =
      fieldText('f-last-name',   'Фамилия',  f.LAST_NAME   || f.LASTNAME   || '', { placeholder: 'Иванов' }) +
      fieldText('f-first-name',  'Имя',      f.NAME                         || '', { placeholder: 'Сергей' }) +
      fieldText('f-second-name', 'Отчество', f.SECOND_NAME || f.SECONDNAME || '', { placeholder: 'Петрович' });
  }

  // ── БЛОК 2: Долг ──────────────────────────────────────────────────────────
  const sec2 = document.getElementById('section-2-body');
  if (sec2) {
    sec2.className = 'space-y-4';
    sec2.innerHTML =
      // Сумма долга + Кредиторы в 2 колонки
      `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">` +
        fieldNumber('f-debt-total', 'Общая сумма долга, ₽', f.UF_CRM_1764765055684,
          { placeholder: 'Например: 850 000', hint: 'До 300 000 ₽ процедура обычно невыгодна.' }) +
        fieldText('f-creditors', 'Виды долгов / кредиторы', f.UF_CRM_1764765826044,
          { placeholder: 'Кредиты, микрозаймы, кредитные карты…' }) +
      `</div>` +
      // Несписываемый долг — radio Да/Нет (стоп-фактор: Да = красный)
      fieldRadio('nonDischargeable', 'Это долг, который не списывается? (алименты, субсидиарка, возмещение вреда)',
        '', { yesRed: true });

    attachMoneyMask(sec2);
  }

  // ── БЛОК 3: Просрочки / приставы / удержания ──────────────────────────────
  const sec3 = document.getElementById('section-3-body');
  if (sec3) {
    sec3.className = 'space-y-4';

    const fssp = _ynFromBx(f.UF_CRM_1764767243083);

    // deposit хранится в UF_DEPOSIT (0/1), конвертируем в Y/N
    let depositVal = '';
    if (f.UF_DEPOSIT === 1 || f.UF_DEPOSIT === '1' || f.UF_DEPOSIT === true) depositVal = 'Y';
    else if (f.UF_DEPOSIT === 0 || f.UF_DEPOSIT === '0' || f.UF_DEPOSIT === false) depositVal = 'N';

    sec3.innerHTML =
      fieldText('f-overdue', 'Платежи / просрочки', f.UF_CRM_1764767202050,
        { placeholder: 'Например: просрочка 3 месяца' }) +
      fieldRadio('fssp', 'Передали приставам (ФССП)?', fssp) +
      fieldRadio('deposit', 'Списывают с дохода / есть удержания?', depositVal);
  }

  // ── БЛОК 4: Доход и работа ────────────────────────────────────────────────
  const sec4 = document.getElementById('section-4-body');
  if (sec4) {
    sec4.className = 'space-y-4';
    sec4.innerHTML =
      `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">` +
        fieldNumber('f-official-income',   'Официальный доход, ₽/мес',   f.UF_OFFICIAL_INCOME,   { placeholder: 'Например: 45 000' }) +
        fieldNumber('f-income-unofficial', 'Неофициальный доход, ₽/мес', f.UF_UNOFFICIAL_INCOME, { placeholder: 'Например: 20 000' }) +
      `</div>` +
      fieldSelect('f-salary-card', 'Зарплатная карта', f.UF_CRM_1764767677345, OPTS_SALARY_CARD) +
      fieldRadio('incomeKmBad', 'Доход высокий / вне критериев (невыгодно по расчёту)?', '', { yesRed: true });

    attachMoneyMask(sec4);
  }

  // ── БЛОК 5: Ипотека и залоговое имущество ─────────────────────────────────
  const sec5 = document.getElementById('section-5-body');
  if (sec5) {
    sec5.className = 'space-y-4';

    // Ипотека — значение из поля лида (пока нет отдельного UF, берём из чек-бокса формы)
    const mortgageVal = '';

    sec5.innerHTML =
      // Ипотека Да/Нет + скрытый уточняющий блок
      fieldRadio('mortgage', 'Есть ипотека?', mortgageVal, { toggle: 'block-mortgage' }) +
      `<div id="block-mortgage" class="hidden mt-3 pl-4 border-l-2 border-blue-200 dark:border-blue-800 space-y-3">` +
        fieldRadio('mortgageHasGuarantor', 'Есть поручитель / созаёмщик по ипотеке?', '',
          { small: true, labelClass: 'text-sm text-gray-600 dark:text-gray-400' }) +
        fieldRadio('mortgageBadOverdue', 'Есть грубая просрочка по ипотеке?', '',
          { small: true, yesRed: true, labelClass: 'text-sm text-gray-600 dark:text-gray-400' }) +
      `</div>` +
      // Залог Да/Нет + скрытый уточняющий блок
      fieldRadio('collateral', 'Есть другой залог? (автокредит, залог имущества)', '',
        { toggle: 'block-collateral' }) +
      `<div id="block-collateral" class="hidden mt-3 pl-4 border-l-2 border-blue-200 dark:border-blue-800">` +
        fieldRadio('collateralReadyToPart', 'Готовы расстаться с залогом (отдать в счёт долга)?', '',
          { small: true, noRed: true, labelClass: 'text-sm text-gray-600 dark:text-gray-400' }) +
      `</div>`;

    // Восстанавливаем значение залога из CRM
    const collateralVal = _ynFromBx(f.UF_DEPOSIT);
    if (collateralVal) {
      const collEl = sec5.querySelector(`input[name="collateral"][value="${collateralVal}"]`);
      if (collEl) {
        collEl.checked = true;
        if (collateralVal === 'Y') {
          const blk = document.getElementById('block-collateral');
          if (blk) blk.classList.remove('hidden');
        }
      }
    }
  }

  // ── БЛОК 6: Крупное имущество и сделки ───────────────────────────────────
  const sec6 = document.getElementById('section-6-body');
  if (sec6) {
    sec6.className = 'space-y-4';

    const propertyVal = _ynFromBx(f.UF_POSSESSIONS);

    sec6.innerHTML =
      // Имущество Да/Нет + скрытый блок с репитером
      fieldRadio('property', 'Есть крупное имущество, кроме единственного жилья?', propertyVal,
        { toggle: 'block-property' }) +
      `<div id="block-property" class="${propertyVal === 'Y' ? '' : 'hidden'} mt-3 pl-4 border-l-2 border-blue-200 dark:border-blue-800 space-y-3">
        <div>
          <span class="block mb-2 text-sm text-gray-600 dark:text-gray-400">Перечислите имущество: тип и стоимость каждой позиции</span>
          <div id="property-list" class="space-y-2"></div>
          <button type="button" id="btn-add-property"
                  class="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            Добавить имущество
          </button>
        </div>
        <div class="flex items-start gap-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
          <input type="checkbox" id="f-exclude-car" class="mt-0.5 w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600">
          <label for="f-exclude-car" class="text-xs text-gray-600 dark:text-gray-400">Не учитывать автомобили при сравнении с долгом <span class="block text-gray-400 dark:text-gray-500">(авто можно вывести из конкурсной массы)</span></label>
        </div>
        <div id="property-sum-note" class="hidden text-xs p-2.5 rounded-lg"></div>
        ${fieldRadio('propertyReadyForRisks', 'Готовы к риску реализации имущества?', '',
          { small: true, noRed: true, labelClass: 'text-sm text-gray-600 dark:text-gray-400' })}
      </div>` +
      // Сделки Да/Нет + скрытый блок
      fieldRadio('deals', 'Были сделки за 3 года (продажа, дарение, переоформление)?',
        _ynFromBx(f.UF_DEALS), { toggle: 'block-deals' }) +
      `<div id="block-deals" class="${_ynFromBx(f.UF_DEALS) === 'Y' ? '' : 'hidden'} mt-3 pl-4 border-l-2 border-blue-200 dark:border-blue-800">` +
        fieldRadio('dealsDuringOverdue', 'Сделки были в период просрочек по долгам?', '',
          { small: true, yesRed: true, labelClass: 'text-sm text-gray-600 dark:text-gray-400' }) +
      `</div>`;

    // Вешаем обработчик на кнопку «Добавить имущество» после рендера
    setTimeout(function() {
      const btnAdd = document.getElementById('btn-add-property');
      if (btnAdd) btnAdd.addEventListener('click', _addPropertyRow);
    }, 0);
  }

  // ── БЛОК 7: Семейное положение ────────────────────────────────────────────
  const sec7 = document.getElementById('section-7-body');
  if (sec7) {
    sec7.className = 'space-y-4';

    const jointVal = _ynFromBx(f.UF_CRM_1764767768332);
    const jointValueRaw = f.UF_JOINT_VALUE ? String(f.UF_JOINT_VALUE).replace(/\|RUB/, '') : '';

    sec7.innerHTML =
      `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">` +
        fieldSelect('f-marital',  'В браке?',                   f.UF_CRM_1764767738244, OPTS_MARITAL) +
        fieldSelect('f-children', 'Несовершеннолетние дети',    f.UF_CRM_1764767804861, OPTS_CHILDREN) +
      `</div>` +
      fieldRadio('jointProperty', 'Совместно нажитое имущество с супругом?', jointVal,
        { toggle: 'block-joint' }) +
      `<div id="block-joint" class="${jointVal === 'Y' ? '' : 'hidden'} mt-3 pl-4 border-l-2 border-blue-200 dark:border-blue-800">
        ${fieldNumber('f-joint-value', 'Общая стоимость совместного имущества, ₽', jointValueRaw,
          { placeholder: 'Например: 2 000 000' })}
        <div id="joint-sum-note" class="hidden mt-2 text-xs p-2.5 rounded-lg"></div>
      </div>`;

    attachMoneyMask(sec7);
  }

  // ── БЛОК 8: Фирмы и юрлица ───────────────────────────────────────────────
  const sec8 = document.getElementById('section-8-body');
  if (sec8) {
    sec8.className = 'space-y-4';

    const oooVal = _ynFromBx(f.UF_CRM_1764767873758);
    const ipVal  = _ynFromBx(f.UF_CRM_1764767897075);

    sec8.innerHTML =
      `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">` +
        fieldRadio('ooo', 'Есть ООО?', oooVal, { toggle: 'block-ooo' }) +
        fieldRadio('ip',  'Есть ИП?',  ipVal) +
      `</div>` +
      `<div id="block-ooo" class="${oooVal === 'Y' ? '' : 'hidden'} mt-4 pl-4 border-l-2 border-blue-200 dark:border-blue-800 space-y-3">` +
        fieldRadio('oooHasBalance', 'У ООО есть баланс / активы?', '',
          { small: true, labelClass: 'text-sm text-gray-600 dark:text-gray-400' }) +
        fieldRadio('oooReadyToPart', 'Готовы расстаться с долей в ООО?', '',
          { small: true, noRed: true, labelClass: 'text-sm text-gray-600 dark:text-gray-400' }) +
      `</div>`;
  }

  // ── БЛОК 9: Прочие важные обстоятельства ──────────────────────────────────
  const sec9 = document.getElementById('section-9-body');
  if (sec9) {
    sec9.className = 'space-y-4';

    const criminalVal = _ynFromBx(f.UF_CRM_1764767860124);

    sec9.innerHTML =
      fieldRadio('forOther', 'Обращение за другого человека?', '', { yesRed: true }) +
      fieldRadio('otherCompanyAS', 'Уже подан в Арбитражный суд другой компанией?', '', { yesRed: true }) +
      fieldRadio('criminal', 'Есть судимость?', criminalVal, { toggle: 'block-criminal' }) +
      `<div id="block-criminal" class="${criminalVal === 'Y' ? '' : 'hidden'} mt-3 pl-4 border-l-2 border-blue-200 dark:border-blue-800">` +
        fieldRadio('criminal159SameGrounds', 'Судимость по ст. 159 УК РФ по тем же долгам?', '',
          { small: true, yesRed: true, labelClass: 'text-sm text-gray-600 dark:text-gray-400' }) +
      `</div>`;
  }

  // ── БЛОК 10: Запись ───────────────────────────────────────────────────────
  const sec10 = document.getElementById('section-10-body');
  if (sec10) {
    sec10.className = 'space-y-4';

    const channelVal = f.UF_CRM_1755609681 ? String(f.UF_CRM_1755609681) : '';
    const bookingComment = f.UF_BOOKING_COMMENT || '';

    sec10.innerHTML =
      fieldSelect('f-channel', 'Канал связи', channelVal, OPTS_CHANNEL) +
      `<p class="text-xs text-gray-400 dark:text-gray-500">Значения взяты из поля портала crm.yurclick.com (UF_CRM_1755609681).</p>` +
      fieldText('f-booking-comment', 'Комментарий к записи / договорённость по времени', bookingComment,
        { placeholder: 'Например: перезвонить завтра в 15:00' });
  }

  // ── Поле города (блок 1 → отдельный рендер в шапке) ──────────────────────
  // Город рендерится в шапке формы через отдельный контейнер #city-field-body
  const cityBody = document.getElementById('city-field-body');
  if (cityBody) {
    cityBody.innerHTML = fieldCity('f-client-city', 'Город клиента', f.UF_CRM_1521214081);
    const cityEl = document.getElementById('f-client-city');
    if (cityEl) {
      function _onCityChange() {
        clearCityError();
        const val = cityEl.value.trim();
        const warnEl = document.getElementById('f-client-city-tz-warn');
        if (warnEl) {
          const known = (!val) || (typeof CITIES_TZ !== 'undefined' && CITIES_TZ[val] !== undefined);
          warnEl.classList.toggle('hidden', known);
        }
        setClientCity(val);
      }
      cityEl.addEventListener('change', _onCityChange);
      cityEl.addEventListener('input',  _onCityChange);
    }
  }

  // ── Заметки менеджера (блок 4 старой структуры, оставлен в отдельном контейнере) ──
  const managerBody = document.getElementById('manager-body');
  if (managerBody) {
    managerBody.className = 'px-3 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs';
    managerBody.innerHTML =
      fieldTextarea('f-km-exclusion',  'Исключение из КМ',   f.UF_CRM_1764767905632, { placeholder: 'Причина…' }) +
      fieldTextarea('f-main-pain',     'Основная боль',       f.UF_CRM_1764767920445, { placeholder: 'Главная проблема…' }) +
      fieldTextarea('f-objections',    'Возражения',          f.UF_CRM_1764767933689, { placeholder: 'Возражения клиента…' }) +
      fieldTextarea('f-extra-comment', 'Доп. комментарий',   f.UF_CRM_1764767947408, { placeholder: 'Доп. информация…' });
  }

  // ── Навешиваем toggle-обработчики на все data-toggle radio-кнопки ──────────
  attachToggles();

  // ── Первичный расчёт статуса и прогресса ──────────────────────────────────
  updateTargetStatusWidget();
  updateProgress();
}

// ─── Репитер имущества ───────────────────────────────────────────────────────

let _propRowSeq = 0;

function _addPropertyRow() {
  const list = document.getElementById('property-list');
  if (!list) return;
  _propRowSeq += 1;

  const row = document.createElement('div');
  row.className = 'flex items-center gap-2 property-row';

  row.innerHTML =
    '<select data-prop-type ' +
      'class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-2/5 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white">' +
      '<option value="realty">Недвижимое</option>' +
      '<option value="movable">Движимое</option>' +
      '<option value="car">Автомобиль</option>' +
    '</select>' +
    '<input type="text" inputmode="numeric" data-prop-value data-money="1" ' +
      'class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block flex-1 p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white" ' +
      'placeholder="Стоимость, ₽" autocomplete="off">' +
    '<button type="button" data-prop-remove aria-label="Удалить" ' +
      'class="shrink-0 inline-flex items-center justify-center w-9 h-9 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 dark:bg-red-900/40 dark:text-red-300">' +
      '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
    '</button>';

  list.appendChild(row);

  const valueInput = row.querySelector('[data-prop-value]');
  valueInput.addEventListener('input', function () {
    const digits = valueInput.value.replace(/\D/g, '');
    valueInput.dataset.raw = digits;
    valueInput.value = digits ? Number(digits).toLocaleString('ru-RU') : '';
    updateProgress();
    updateTargetStatusWidget();
  });
  row.querySelector('[data-prop-type]').addEventListener('change', function () {
    updateTargetStatusWidget();
  });
  row.querySelector('[data-prop-remove]').addEventListener('click', function () {
    row.remove();
    updateProgress();
    updateTargetStatusWidget();
  });
}

// ─── Уточняющие блоки (data-toggle) ──────────────────────────────────────────

/**
 * attachToggles — навешивает обработчики на radio-кнопки с data-toggle.
 * При выборе Да показывает блок, при выборе Нет — скрывает.
 */
function attachToggles() {
  const togglers = document.querySelectorAll('input[data-toggle]');
  togglers.forEach(function (input) {
    input.addEventListener('change', function () {
      const blockId = input.getAttribute('data-toggle');
      const block = document.getElementById(blockId);
      if (!block) return;
      if (input.value === 'Y' && input.checked) {
        block.classList.remove('hidden');
      } else if (input.value === 'N' && input.checked) {
        block.classList.add('hidden');
      }
    });
  });
}

// ─── Прогресс заполнения ─────────────────────────────────────────────────────

export function updateProgress() {
  const form = document.getElementById('anketa-form');
  if (!form) return;

  const inputs = form.querySelectorAll('input:not([readonly]):not([type="radio"]):not([type="checkbox"]),select,textarea');
  let filled = 0;
  inputs.forEach(function(el) {
    if (el.value && el.value.trim() !== '') filled++;
  });

  // Дополнительно считаем заполненные radio-группы
  const radioGroups = {};
  form.querySelectorAll('input[type="radio"]:checked').forEach(function(el) {
    radioGroups[el.name] = true;
  });
  const filledRadio = Object.keys(radioGroups).length;

  const total = inputs.length + Object.keys(
    (function() {
      const groups = {};
      form.querySelectorAll('input[type="radio"]').forEach(function(el) { groups[el.name] = true; });
      return groups;
    })()
  ).length;
  const totalFilled = filled + filledRadio;

  const pct = total ? Math.round((totalFilled / total) * 100) : 0;

  const bar = document.getElementById('progress-bar');
  const lbl = document.getElementById('progress-label');
  if (bar) bar.style.width = `${pct}%`;
  if (lbl) lbl.textContent = `${totalFilled} / ${total}`;
}

document.addEventListener('change', function(e) {
  if (e.target.closest('#anketa-form')) updateProgress();
});

// ─── Виджет статуса «Целевой/Нецелевой» ──────────────────────────────────────

export function updateTargetStatusWidget() {
  if (typeof window.TargetStatus === 'undefined' ||
      typeof window.TargetStatus.evaluate !== 'function') {
    return;
  }

  const formData = collectFormData();
  const status   = window.TargetStatus.evaluate(formData);
  window.__targetStatus = status;

  // Обновляем бейдж в блоке «Итог»
  const badgeEl = document.getElementById('target-status-badge');
  if (badgeEl) {
    const baseCls = 'inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg';
    let colorCls = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
    if (status.id === window.TargetStatus.IDS.TARGET) {
      colorCls = 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    } else if (status.id === window.TargetStatus.IDS.NON_TARGET) {
      colorCls = 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
    }
    badgeEl.className   = `${baseCls} ${colorCls}`;
    badgeEl.textContent = `Статус: ${status.label}`;
  }

  // Обновляем список причин
  const reasonsEl = document.getElementById('verdict-reasons');
  const reasonsList = document.getElementById('verdict-reasons-list');
  if (reasonsEl && reasonsList) {
    if (status.reasons && status.reasons.length > 0) {
      reasonsList.innerHTML = status.reasons.map(function(r) {
        return `<li>${escHtml(r)}</li>`;
      }).join('');
      reasonsEl.classList.remove('hidden');
    } else {
      reasonsList.innerHTML = '';
      reasonsEl.classList.add('hidden');
    }
  }

  // Также обновляем старый виджет в блоке признаков нецелевой (если существует)
  const oldBadge = document.getElementById('target-status-badge-old');
  if (oldBadge) {
    oldBadge.textContent = status.label;
  }
}

document.addEventListener('change', function (e) {
  if (e.target.closest('#anketa-form')) updateTargetStatusWidget();
});
document.addEventListener('input', function (e) {
  if (e.target.closest('#anketa-form')) updateTargetStatusWidget();
});
