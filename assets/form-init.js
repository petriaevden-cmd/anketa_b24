/**
 * form-init.js — инициализация формы данными лида.
 *
 * v5-latest: переработана под прототип v10.
 * Структура анкеты приведена к 10 разделам прототипа.
 * Все Да/Нет поля рендерятся как radio-переключатели через fieldRadio().
 * Скрытые уточняющие блоки работают через data-toggle (attachToggles).
 *
 * Зависит от form-render.js и target-status.js (window.TargetStatus).
 *
 * ВАЖНО: НЕТ импортов из form-submit.js — циклический импорт устранён.
 * updateTargetStatusWidget() использует локальный _collectFormLocal(),
 * который дублирует только поля, нужные для evaluateTargetStatus().
 */

import {
  fieldText, fieldNumber, fieldSelect, fieldTextarea,
  fieldCheckbox, fieldRadio, fieldCity, escHtml, attachMoneyMask,
  OPTS_SALARY_CARD, OPTS_MARITAL, OPTS_CHILDREN
} from './form-render.js';
import { clearCityError } from './form-submit.js';
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

// ─── Локальный сбор данных (без импорта из form-submit.js) ───────────────────

/**
 * _collectFormLocal — собирает ТОЛЬКО поля, нужные для evaluateTargetStatus().
 * Это локальная копия логики из collectFormData(), без зависимости на form-submit.js.
 * Разрывает циклический импорт: form-init.js ↔ form-submit.js.
 */
function _collectFormLocal() {
  function vr(name) {
    const el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }
  function vMoney(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    if (typeof el.dataset.raw === 'string' && el.dataset.raw !== '') return el.dataset.raw;
    return String(el.value || '').replace(/\D+/g, '');
  }

  const mortgageHasGuarantor = vr('mortgageHasGuarantor');
  const debt = parseInt(vMoney('f-debt-total') || '0', 10) || 0;

  // Список имущества и сравнение с долгом
  const rows = document.querySelectorAll('#property-list .property-row');
  const excludeCar = (document.getElementById('f-exclude-car') || {}).checked;
  let propertySum = 0;
  rows.forEach(function(row) {
    const typeEl = row.querySelector('[data-prop-type]');
    const valEl  = row.querySelector('[data-prop-value]');
    if (typeEl && valEl) {
      if (excludeCar && typeEl.value === 'car') return;
      propertySum += parseInt((valEl.dataset && valEl.dataset.raw) || '0', 10) || 0;
    }
  });

  // Совместное имущество
  const jointValueEl = document.getElementById('f-joint-value');
  const jointValue = jointValueEl
    ? (parseInt((jointValueEl.dataset && jointValueEl.dataset.raw) || jointValueEl.value || '0', 10) || 0)
    : 0;

  const f = {
    debtTotal:              vMoney('f-debt-total'),
    nonDischargeable:       vr('nonDischargeable'),
    fssp:                   vr('fssp'),
    deposit:                vr('deposit'),
    incomeKmBad:            vr('incomeKmBad'),
    mortgage:               vr('mortgage'),
    mortgageHasGuarantor:   mortgageHasGuarantor,
    mortgageBadOverdue:     vr('mortgageBadOverdue'),
    collateral:             vr('collateral'),
    collateralReadyToPart:  vr('collateralReadyToPart'),
    property:               vr('property'),
    propertySum:            propertySum,
    propertyExcludeCar:     excludeCar,
    propertyReadyForRisks:  vr('propertyReadyForRisks'),
    deals:                  vr('deals'),
    dealsDuringOverdue:     vr('dealsDuringOverdue'),
    jointProperty:          vr('jointProperty'),
    jointValue:             jointValue,
    ooo:                    vr('ooo'),
    ip:                     vr('ip'),
    oooHasBalance:          vr('oooHasBalance'),
    oooReadyToPart:         vr('oooReadyToPart'),
    forOther:               vr('forOther'),
    otherCompanyAS:         vr('otherCompanyAS'),
    criminal:               vr('criminal'),
    criminal159SameGrounds: vr('criminal159SameGrounds')
  };

  // Инверсия: правило «ипотека» ждёт mortgageNoGuarantor
  f.mortgageNoGuarantor = (mortgageHasGuarantor === 'N') ? 'Y' : (mortgageHasGuarantor === 'Y' ? 'N' : '');

  // Автоматические признаки сравнения имущества с долгом
  f.propertyOverDebt = (debt > 0 && propertySum > debt) ? 'Y' : 'N';

  const jointShare = jointValue / 2;
  f.jointShare = jointShare;
  const _isYes = function(v) { return v === 'Y' || v === true || v === 1 || v === '1'; };
  f.jointOverDebt = (_isYes(f.jointProperty) && debt > 0 && jointShare > debt) ? 'Y' : 'N';

  return f;
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

    // Примечание: для залога отдельного UF-поля в ТК НЕТ — не читаем UF_DEPOSIT (это удержания, другое поле).
    // Значение radio collateral будет пустым при загрузке лида.
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

  // Раздел «10. Запись» удалён: канал консультации и комментарий теперь
  // задаются в booking-панели справа (booking.js, select #bp-channel) и уходят
  // в БП «Назначить встречу». Анкета их больше не собирает и не пишет в лид.

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

  // ── Обработчики кнопки «Добавить имущество» и авто-строка ─────────────────
  setTimeout(function() {
    const btnAdd = document.getElementById('btn-add-property');
    if (btnAdd) btnAdd.addEventListener('click', function() {
      _addPropertyRow();
      updateProgress();
      updateTargetStatusWidget();
    });

    // При первом выборе «Да» у radio property — автоматически добавляем первую строку (как в прототипе)
    document.querySelectorAll('input[name="property"][value="Y"]').forEach(function(radio) {
      radio.addEventListener('change', function() {
        if (radio.checked && document.querySelectorAll('#property-list .property-row').length === 0) {
          _addPropertyRow();
        }
      });
    });

    // Чекбокс «не учитывать авто» — пересчитываем сравнение
    const excludeCarEl = document.getElementById('f-exclude-car');
    if (excludeCarEl) excludeCarEl.addEventListener('change', function() {
      updateTargetStatusWidget();
      _refreshSumNotes();
    });
  }, 0);

  // ── Обработчики формы: прогресс + статус при любом изменении ─────────────
  // КРИТИЧНО: навешиваем ЗДЕСЬ, внутри initForm(), а НЕ на уровне модуля.
  // Это предотвращает краш: обработчики регистрируются только после полного
  // рендера HTML и инициализации всех зависимостей.
  const form = document.getElementById('anketa-form');
  if (form) {
    form.addEventListener('input', function() {
      updateProgress();
      updateTargetStatusWidget();
    });
    form.addEventListener('change', function() {
      updateProgress();
      updateTargetStatusWidget();
    });

  }

  // ── Первичный расчёт статуса и прогресса ──────────────────────────────────
  updateTargetStatusWidget();
  updateProgress();
}

// ─── Подсказки-сравнения имущества vs долг (точная копия из прототипа) ───────────

function _toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/\D+/g, ''));
  return isFinite(n) ? n : null;
}

/**
 * _refreshSumNotes — обновляет цветные подсказки под репитером имущества
 * и под полем совместного имущества (аналог refreshSumNotes из прототипа).
 */
export function _refreshSumNotes() {
  const debtEl = document.getElementById('f-debt-total');
  const debt = debtEl ? (_toNumber(debtEl.dataset.raw) || 0) : 0;
  const fmt = function(n) { return Number(n).toLocaleString('ru-RU') + ' ₽'; };

  const NOTE_OVER = 'text-xs p-2.5 rounded-lg bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
  const NOTE_OK   = 'text-xs p-2.5 rounded-lg bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';

  // 1. Доп. имущество
  const propNote = document.getElementById('property-sum-note');
  const propRadio = document.querySelector('input[name="property"]:checked');
  if (propNote) {
    if (propRadio && propRadio.value === 'Y') {
      const rows = document.querySelectorAll('#property-list .property-row');
      const excludeCar = (document.getElementById('f-exclude-car') || {}).checked;
      let propSum = 0;
      rows.forEach(function(row) {
        const typeEl = row.querySelector('[data-prop-type]');
        const valEl  = row.querySelector('[data-prop-value]');
        if (typeEl && valEl) {
          if (excludeCar && typeEl.value === 'car') return;
          propSum += parseInt((valEl.dataset && valEl.dataset.raw) || '0', 10) || 0;
        }
      });
      if (propSum > 0) {
        const carHint = excludeCar ? ' (без авто)' : '';
        if (debt <= 0) {
          propNote.className = NOTE_OK;
          propNote.textContent = 'Сумма доп. имущества' + carHint + ': ' + fmt(propSum) + '. Укажите сумму долга, чтобы сравнить.';
        } else if (propSum > debt) {
          propNote.className = NOTE_OVER;
          propNote.textContent = 'Сумма доп. имущества' + carHint + ' ' + fmt(propSum) + ' больше долга ' + fmt(debt) + ' → статус нецелевой.';
        } else {
          propNote.className = NOTE_OK;
          propNote.textContent = 'Сумма доп. имущества' + carHint + ' ' + fmt(propSum) + ' не превышает долг ' + fmt(debt) + '.';
        }
        propNote.classList.remove('hidden');
      } else {
        propNote.classList.add('hidden');
      }
    } else {
      propNote.classList.add('hidden');
    }
  }

  // 2. Совместное имущество
  const jointNote = document.getElementById('joint-sum-note');
  const jointRadio = document.querySelector('input[name="jointProperty"]:checked');
  const jointEl = document.getElementById('f-joint-value');
  const jointValue = jointEl ? (_toNumber(jointEl.dataset.raw) || _toNumber(jointEl.value) || 0) : 0;
  if (jointNote) {
    if (jointRadio && jointRadio.value === 'Y' && jointValue > 0) {
      const share = jointValue / 2;
      if (debt <= 0) {
        jointNote.className = 'mt-2 ' + NOTE_OK;
        jointNote.textContent = 'Совместное имущество ' + fmt(jointValue) + ', доля клиента ' + fmt(share) + ' (половина). Укажите долг.';
      } else if (share > debt) {
        jointNote.className = 'mt-2 ' + NOTE_OVER;
        jointNote.textContent = 'Доля клиента ' + fmt(share) + ' (половина от ' + fmt(jointValue) + ') больше долга ' + fmt(debt) + ' → статус нецелевой.';
      } else {
        jointNote.className = 'mt-2 ' + NOTE_OK;
        jointNote.textContent = 'Доля клиента ' + fmt(share) + ' (половина от ' + fmt(jointValue) + ') не превышает долг ' + fmt(debt) + '.';
      }
      jointNote.classList.remove('hidden');
    } else {
      jointNote.classList.add('hidden');
    }
  }
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

  // Считаем только видимые поля (как в прототипе — скрытые уточнения не давят на прогресс)
  const texts = form.querySelectorAll('input[type="text"], select');
  const radioGroups = {};
  form.querySelectorAll('input[type="radio"]').forEach(function (r) {
    if (r.closest('.hidden')) return; // скрытое уточнение не учитываем
    radioGroups[r.name] = radioGroups[r.name] || false;
    if (r.checked) radioGroups[r.name] = true;
  });

  let total = 0;
  let filled = 0;

  texts.forEach(function (el) {
    if (el.closest('.hidden')) return;
    total++;
    if (el.value && el.value.trim() !== '') filled++;
  });

  Object.keys(radioGroups).forEach(function (name) {
    total++;
    if (radioGroups[name]) filled++;
  });

  const percent = total ? Math.round((filled / total) * 100) : 0;
  const bar = document.getElementById('progress-bar');
  const lbl = document.getElementById('progress-label');
  if (bar) bar.style.width = percent + '%';
  if (lbl) lbl.textContent = percent + '%';
}

// ─── Виджет статуса «Целевой/Нецелевой» ──────────────────────────────────────

export function updateTargetStatusWidget() {
  if (typeof window.TargetStatus === 'undefined' ||
      typeof window.TargetStatus.evaluate !== 'function') {
    return;
  }

  // Используем локальный сбор данных — БЕЗ импорта из form-submit.js
  const formData = _collectFormLocal();
  const status   = window.TargetStatus.evaluate(formData);
  window.__targetStatus = status;

  // Обновляем подсказки сравнения (как в прототипе)
  _refreshSumNotes();

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
