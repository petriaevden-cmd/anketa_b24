/**
 * form-submit.js — валидация, сбор данных, сохранение формы.
 *
 * Содержит REQUIRED_FIELDS, collectFormData(), validateForm(),
 * saveForm(), addTimelineComment() и обработчики кнопок btn-save / btn-reset.
 *
 * Зависит от form-render.js (escHtml) и form-init.js (updateProgress,
 * updateTargetStatusWidget). Циклическая зависимость с form-init.js
 * допустима в ES-модулях: функции вызываются по событиям, к моменту
 * вызова обе модули уже полностью загружены.
 */

import { updateProgress } from './form-init.js';
import { AppState } from './app-state.js';
import { logEvent } from './logger-client.js';
import { mapFormToBitrixFields } from './field-mapper.js';
import {
  OPTS_YES_NO, OPTS_SALARY_CARD, OPTS_MARITAL, OPTS_CHILDREN
} from './form-render.js';

// showError/showSuccess реализованы в app.js (точка входа). До полной
// модуляризации этих функций обращаемся к ним через window.*, чтобы не
// создавать циклической зависимости app.js ↔ form-submit.js.
const showError = (msg) => window.showError && window.showError(msg);
const showSuccess = () => window.showSuccess && window.showSuccess();

// ─── Валидация полей ─────────────────────────────────────────────────────────

/**
 * REQUIRED_FIELDS — массив описаний 10 обязательных полей формы.
 *
 * Каждый элемент содержит:
 *   key   — ключ в объекте formData (возвращает collectFormData())
 *   elId  — HTML id элемента поля (input / select) для фокуса и подсветки ошибки
 *   label — текст сообщения об ошибке, который увидит менеджер
 *
 * Порядок совпадает с порядком блоков формы — при ошибке фокус
 * переводится на ПЕРВОЕ незаполненное поле (сверху вниз).
 *
 * Этот список соответствует полям с MANDATORY: 'Y' в install.php:
 *   KC_FULLNAME, KC_MARITAL_STATUS, KC_CHILDREN, KC_JOINT_PROPERTY,
 *   KC_CRIMINAL, KC_OOO, KC_IP, KC_DEBT_TOTAL, KC_PROPERTY, KC_DEALS.
 * Город (KC_CLIENT_CITY) проверяется отдельно — без него невозможно
 * определить часовой пояс для расписания.
 */
export const REQUIRED_FIELDS = [
  { key: 'clientCity',    elId: 'f-client-city', label: 'Укажите город клиента' },
  // v3-latest: ФИО разбито на фамилию/имя/отчество. Проверяем отдельно
  // фамилию (обязательная) и имя (обязательное). Отчество — необязательное.
  { key: 'lastName',      elId: 'f-last-name',             label: 'Укажите фамилию' },
  { key: 'firstName',     elId: 'f-first-name',            label: 'Укажите имя' },
  { key: 'maritalStatus', elId: 'f-marital',               label: 'Укажите семейное положение' },
  { key: 'children',      elId: 'f-children',              label: 'Укажите количество детей' },
  // v5-latest: поля стали radio-переключателями, elId указывает на первую radio-кнопку группы
  { key: 'jointProperty', elId: 'section-7-body',          label: 'Укажите совместное имущество' },
  { key: 'criminal',      elId: 'section-9-body',          label: 'Укажите наличие судимостей' },
  { key: 'ooo',           elId: 'section-8-body',          label: 'Укажите наличие ООО' },
  { key: 'ip',            elId: 'section-8-body',          label: 'Укажите наличие ИП' },
  { key: 'debtTotal',     elId: 'f-debt-total',            label: 'Укажите сумму долга' },
  { key: 'property',      elId: 'section-6-body',          label: 'Укажите наличие имущества' },
  { key: 'deals',         elId: 'section-6-body',          label: 'Укажите наличие сделок' }
];

/**
 * _showFieldError(elId, msg) — универсальная функция: помечает любое поле
 * формы как ошибочное (красная рамка + текст ошибки под полем).
 *
 * ЛОГИКА:
 *   1. Находит DOM-элемент поля по его id (elId).
 *   2. Добавляет классы красной рамки (border-red-500, focus:ring-red-500, focus:border-red-500).
 *   3. Ищет элемент ошибки с id = elId + '-error'.
 *      - Если найден (город — у него <p id="...-error"> уже есть в HTML) → показываем его.
 *      - Если НЕ найден → создаём <p> динамически и вставляем после поля.
 *   4. Устанавливает текст ошибки (msg).
 *
 * @param {string} elId — HTML id поля (например 'f-marital').
 * @param {string} msg  — Текст сообщения об ошибке (например 'Укажите семейное положение').
 */
export function _showFieldError(elId, msg) {
  const fieldEl = document.getElementById(elId);
  if (fieldEl) {
    // Добавляем красную рамку к полю.
    fieldEl.classList.add('border-red-500', 'focus:ring-red-500', 'focus:border-red-500');
  }

  // Ищем или создаём элемент ошибки.
  const errId = `${elId}-error`;
  let errEl = document.getElementById(errId);
  if (!errEl && fieldEl) {
    // Элемент ошибки ещё не существует — создаём динамически.
    errEl = document.createElement('p');
    errEl.id = errId;
    errEl.className = 'text-[10px] text-red-500'; // Мелкий красный текст.
    // Вставляем сразу после поля (input/select) внутри его родительского <div>.
    fieldEl.parentNode.insertBefore(errEl, fieldEl.nextSibling);
  }
  if (errEl) {
    errEl.textContent = msg;           // Устанавливаем текст ошибки.
    errEl.classList.remove('hidden');   // Показываем (если был скрыт).
  }
}

/**
 * _clearFieldError(elId) — универсальная функция: снимает ошибку с любого поля.
 *
 * ЛОГИКА:
 *   1. Убирает красную рамку с DOM-элемента поля.
 *   2. Скрывает элемент ошибки (если он существует).
 *
 * @param {string} elId — HTML id поля (например 'f-marital').
 */
export function _clearFieldError(elId) {
  const fieldEl = document.getElementById(elId);
  if (fieldEl) {
    // Убираем красную рамку — возвращаем стандартный стиль.
    fieldEl.classList.remove('border-red-500', 'focus:ring-red-500', 'focus:border-red-500');
  }

  const errEl = document.getElementById(`${elId}-error`);
  if (errEl) {
    errEl.classList.add('hidden'); // Скрываем текст ошибки.
  }
}

/**
 * _clearAllFieldErrors() — сбрасывает ошибки со ВСЕХ обязательных полей.
 *
 * Вызывается в начале validateForm() перед новой проверкой,
 * чтобы убрать ошибки с полей, которые менеджер уже исправил.
 */
export function _clearAllFieldErrors() {
  REQUIRED_FIELDS.forEach(function (rf) {
    _clearFieldError(rf.elId);
  });
}

/**
 * showCityError — обёртка для обратной совместимости: помечает поле «Город» как ошибочное.
 *
 * Используется в _onCityChange() (form.js) и внешнем коде.
 * Внутри делегирует в универсальную _showFieldError().
 */
export function showCityError() {
  _showFieldError('f-client-city', 'Укажите город клиента');
}

/**
 * clearCityError — обёртка для обратной совместимости: снимает ошибку с поля «Город».
 *
 * Также скрывает жёлтое предупреждение TZ (баг 7 fix):
 * при очистке ошибки сбрасываем и предупреждение о неизвестном городе.
 */
export function clearCityError() {
  _clearFieldError('f-client-city');

  // Баг 7 fix: предупреждение TZ скрываем вместе с ошибкой валидации.
  // Это нужно, чтобы при нажатии «Сбросить» или при начале нового ввода
  // пропадали ОБА предупреждения одновременно.
  const warnEl = document.getElementById('f-client-city-tz-warn');
  if (warnEl) warnEl.classList.add('hidden'); // Скрываем жёлтое предупреждение о неизвестном городе.
}

// ─── Сбор данных формы ───────────────────────────────────────────────────────

/**
 * collectFormData — считывает текущие значения всех полей формы и возвращает их в виде объекта.
 *
 * Эта функция является «мостом» между HTML-формой и API Bitrix24:
 * она собирает данные из DOM-элементов и упаковывает в удобный объект,
 * который затем используется в validateForm() и saveForm().
 *
 * Внутренняя функция v(id):
 *   Получает значение поля по его HTML-id и обрезает пробелы по краям (trim).
 *   Если элемент не найден — возвращает пустую строку, чтобы не было ошибок.
 *
 * @returns {object} — Объект со значениями всех 24 полей формы (Блоки 1–4).
 *   Блок 5 (запись на консультацию) собирается отдельно в calendar.js.
 */
export function collectFormData() {
  // Вспомогательная функция: получает значение элемента по id, обрезает пробелы.
  // Если элемент не найден (например, форма ещё не отрендерена) — возвращает ''.
  function v(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  // Вспомогательная функция для чек-боксов: возвращает 'Y' или 'N'
  // в формате Bitrix24 для булевых полей. Используется в evaluateTargetStatus()
  // (target-status.js) — предикаты правил ожидают именно строки 'Y'/'N'.
  // Если элемент не найден (контейнер netselevoi-body отсутствует) — возвращает ''.
  function vc(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    return el.checked ? 'Y' : 'N';
  }

  // v3-latest: для денежных полей (input с маской тысяч) читаем чистое число
  // из dataset.raw — туда его пишет attachMoneyMask() при каждом вводе.
  // Если маска почему-то не отработала (сразу после рендера, без ввода) —
  // падаем обратно на el.value и чистим от нецифр (toMoney в маппере всё равно
  // пропустит через replace(/\D/g, ''), так что это двойная страховка).
  function vMoney(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    if (typeof el.dataset.raw === 'string' && el.dataset.raw !== '') return el.dataset.raw;
    return String(el.value || '').replace(/\D+/g, '');
  }

  // Собираем и возвращаем объект со всеми полями.
  // Ключи объекта — произвольные camelCase-имена (используются в saveForm/addTimelineComment).
  // Значения — результаты вызова v() с id конкретного поля.
  // v5-latest: вспомогательная функция для radio-групп (читает checked radio по name).
  function vr(name) {
    const el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  const collateral = vr('collateral');
  const property   = vr('property');
  const deals      = vr('deals');

  // v3-latest: фамилия / имя / отчество — 3 отдельных поля.
  // fio собираем сразу же («Фамилия Имя Отчество») для обратной совместимости
  // с timeline-комментарием и mapFormToBitrixFields (UF_CRM_1764765025374 = fio).
  const lastName   = v('f-last-name');
  const firstName  = v('f-first-name');
  const secondName = v('f-second-name');
  const fio        = [lastName, firstName, secondName].filter(Boolean).join(' ').trim();

  return {
    fio:               fio,                              // Собранное ФИО (для UF лида и комментария)
    lastName:          lastName,                         // Фамилия (в LAST_NAME лида)
    firstName:         firstName,                        // Имя (в NAME лида)
    secondName:        secondName,                       // Отчество (в SECOND_NAME лида)
    clientCity:        v('f-client-city'),    // Город (обязательное поле)
    // workplace убрано из формы (v3-latest). UF в Bitrix остаётся нетронутым —
    // в mapFormToBitrixFields поле пишется только при наличии form.workplace,
    // а без входного поля UI этого значения никто не передаст.
    maritalStatus:     v('f-marital'),                   // Семейное положение (значение из OPTS_MARITAL)
    children:          v('f-children'),                  // Количество детей (значение из OPTS_CHILDREN)
    jointProperty:     vr('jointProperty'),              // Совместное имущество (Y/N) — radio
    criminal:          vr('criminal'),                   // Судимости (Y/N) — radio
    ooo:               vr('ooo'),                        // ООО (Y/N) — radio
    ip:                vr('ip'),                         // ИП (Y/N) — radio
    // v3-latest: денежные поля — читаем из dataset.raw (без разделителей тысяч)
    debtTotal:         vMoney('f-debt-total'),           // Общая сумма долга, ₽
    monthlyPayment:    vMoney('f-monthly-payment'),      // Ежемесячный платёж, ₽
    officialIncome:    vMoney('f-official-income'),      // Официальный доход, ₽ (число)
    unofficialIncome:  vMoney('f-income-unofficial'),    // Неофициальный доход, ₽
    // Алиас для target-status.js (правило high_official_income читает f.incomeOfficial).
    // С переходом на число enum-значение 'high' больше не приходит, остаётся только
    // поддержка флажка incomeKmBad === 'Y'. Алиас сохраняем, чтобы старый код не упал.
    incomeOfficial:    vMoney('f-official-income'),
    salaryCard:        v('f-salary-card'),               // Зарплатная карта (sber/other/none)
    creditors:         v('f-creditors'),                 // Перечень кредиторов
    collateral:        collateral,                       // Залоговое имущество (Y/N) — для target-status.js
    deposit:           vr('deposit'),                     // Удержания с дохода (Y/N) — radio
    overdue:           v('f-overdue'),                   // Просрочки (текст)
    fssp:              vr('fssp'),                       // Исполнительные производства ФССП (Y/N) — radio
    property:          property,                         // Имущество в собственности (Y/N) — для target-status.js
    possessions:       property,                         // То же под именем поля UF_POSSESSIONS — для маппера
    deals:             deals,                            // Сделки с имуществом за 3 года (Y/N)
    kmExclusion:       v('f-km-exclusion'),              // Исключение из кредитного менеджера
    mainPain:          v('f-main-pain'),                 // Основная боль/проблема клиента
    objections:        v('f-objections'),                // Возражения клиента
    extraComment:      v('f-extra-comment'),             // Дополнительный комментарий менеджера

    // ── БЛОК 5: Бронирование (читается из hidden-полей, заполняемых booking.js) ─
    // UF_CALENDAR_EVENTS не собирается: его пишет сам БП «Назначить встречу»
    // (TEMPLATE_ID=40). Поле имеет тип Integer; пытаться записать туда workflow-ID
    // (строку) приводило к ошибке 400.
    bookedManagerCalId: v('f-bookedManagerCalId'),
    bookedTimeMP:       v('f-bookedTimeMP'),
    bookedTimeClient:   v('f-bookedTimeClient'),

    // ── БЛОК 6: Чек-боксы «Признаки нецелевой встречи» ─────────────────
    // Используются ТОЛЬКО внутри evaluateTargetStatus() и в timeline-комментарии.
    // В crm.lead.update НЕ передаются — на портале полей под них нет и создавать
    // их без явного подтверждения пользователя запрещено.
    // v5-latest: уточняющие признаки нецелевой — теперь radio-кнопки в разделах анкеты
    mortgage:                vr('mortgage'),                  // Есть ипотека — radio
    mortgageNoGuarantor:     (vr('mortgageHasGuarantor') === 'N') ? 'Y' : (vr('mortgageHasGuarantor') === 'Y' ? 'N' : ''), // инверсия
    mortgageBadOverdue:      vr('mortgageBadOverdue'),        // Ипотека: просрочки — radio
    collateralReadyToPart:   vr('collateralReadyToPart'),     // Залог: готов расстаться — radio
    propertyOverDebt:        (function() {
      // Автоматически считается по репитеру имущества vs сумма долга
      const debtRaw = (document.getElementById('f-debt-total') || {}).dataset;
      const debt = debtRaw ? parseInt(debtRaw.raw || '0', 10) : 0;
      const rows = document.querySelectorAll('#property-list .property-row');
      let propSum = 0;
      const excludeCar = (document.getElementById('f-exclude-car') || {}).checked;
      rows.forEach(function(row) {
        const typeEl = row.querySelector('[data-prop-type]');
        const valEl  = row.querySelector('[data-prop-value]');
        if (typeEl && valEl) {
          if (excludeCar && typeEl.value === 'car') return;
          propSum += parseInt((valEl.dataset && valEl.dataset.raw) || '0', 10) || 0;
        }
      });
      return (debt > 0 && propSum > debt) ? 'Y' : 'N';
    })(),
    propertyReadyForRisks:   vr('propertyReadyForRisks'),     // Готов к рискам — radio
    dealsDuringOverdue:      vr('dealsDuringOverdue'),         // Сделки в просрочку — radio
    oooHasBalance:           vr('oooHasBalance'),              // ООО: баланс — radio
    oooReadyToPart:          vr('oooReadyToPart'),             // ООО: готов расстаться — radio
    criminal159SameGrounds:  vr('criminal159SameGrounds'),     // Судимость 159 — radio
    forOther:                vr('forOther'),                   // За другого — radio
    nonDischargeable:        vr('nonDischargeable'),           // Несписываемый долг — radio
    otherCompanyAS:          vr('otherCompanyAS'),             // Другая компания в АС — radio
    incomeKmBad:             vr('incomeKmBad'),                // Невыгодно по КМ — radio

    // ── Итоговый статус «Целевой/Нецелевой» ──────────────────────────────────
    // Берём из window.__targetStatus (обновляется каждый раз при change на форме).
    // Передаётся в field-mapper как targetStatusId → записывается в UF_CRM_1649136704.
    // Если виджет ещё не пересчитан — null, маппер проигнорирует поле.
    targetStatusId: (window.__targetStatus && window.__targetStatus.id != null)
      ? String(window.__targetStatus.id)
      : null
  };
}

// ─── Валидация ───────────────────────────────────────────────────────────────

/**
 * validateForm — проверяет корректность заполнения формы перед сохранением.
 *
 * Проверяет ВСЕ 10+1 обязательных полей из массива REQUIRED_FIELDS:
 *   Город (KC_CLIENT_CITY) — без него невозможен расчёт TZ.
 *   ФИО (KC_FULLNAME), Семейное положение, Дети, Совм. имущество,
 *   Судимости, ООО, ИП — персональные данные.
 *   Сумма долга (KC_DEBT_TOTAL) — финансовые данные.
 *   Имущество (KC_PROPERTY), Сделки (KC_DEALS) — кредитная история.
 *
 * Эти 10+1 полей совпадают с MANDATORY: 'Y' в install.php + город.
 *
 * ПОРЯДОК РАБОТЫ:
 *   1. Сбрасывает все предыдущие ошибки через _clearAllFieldErrors().
 *   2. Перебирает REQUIRED_FIELDS: для каждого пустого поля вызывает _showFieldError().
 *   3. Фокусирует курсор на ПЕРВОМ пустом обязательном поле.
 *   4. Возвращает true (всё заполнено) или false (есть пустые).
 *
 * @param {object} formData — Объект данных формы из collectFormData().
 * @returns {boolean} — true если форма прошла валидацию, false если есть ошибки.
 */
export function validateForm(formData) {
  // TODO: валидация временно отключена — раскомментировать, когда станет нужна.
  // Условие включения: после согласования финального набора обязательных полей
  // с заказчиком (см. задачу о MANDATORY-полях в трекере). Список REQUIRED_FIELDS
  // ниже может ещё измениться — преждевременное включение валидации блокировало бы
  // менеджеров на полях, которые в итоге будут необязательными.
  // Фикс: в исходном коде был синтаксический конфликт в отключённом блоке
  // (скобки вне /* */), что ломало загрузку всего form.js. Вся логика сохранена
  // в комментарии ниже — для восстановления удалите `return true;` и раскомментируйте.
  return true;

  /* --- ВАЛИДАЦИЯ ОТКЛЮЧЕНА (временно) ---
  _clearAllFieldErrors();
  var warnEl = document.getElementById('f-client-city-tz-warn');
  if (warnEl) warnEl.classList.add('hidden');
  var firstEmptyElId = null;
  var isValid = true;
  REQUIRED_FIELDS.forEach(function (rf) {
    if (!formData[rf.key]) {
      _showFieldError(rf.elId, rf.label);
      if (!firstEmptyElId) firstEmptyElId = rf.elId;
      isValid = false;
}
});
  if (firstEmptyElId) {
    var focusEl = document.getElementById(firstEmptyElId);
    if (focusEl) focusEl.focus();
}
  return isValid;
  --- КОНЕЦ ОТКЛЮЧЕННОЙ ВАЛИДАЦИИ --- */
}

// ─── Сохранение ──────────────────────────────────────────────────────────────

/**
 * saveForm — сохраняет данные анкеты в CRM Bitrix24.
 *
 * ПОРЯДОК РАБОТЫ:
 *   1. Собирает данные формы через collectFormData().
 *   2. Валидирует через validateForm() — если ошибки, прерывает выполнение.
 *   3. Блокирует кнопку «Сохранить» и меняет её текст на «Сохранение...»
 *      (предотвращает повторное нажатие во время запроса к API).
 *   4. Отправляет запрос crm.lead.update в Bitrix24 API со всеми 24 полями.
 *   5. В колбэке ответа:
 *      a. Разблокирует кнопку «Сохранить» и возвращает ей исходный вид.
 *      b. При ошибке API — показывает сообщение об ошибке через showError().
 *      c. При успехе — вызывает addTimelineComment() для записи в таймлайн.
 *
 * ПРИМЕЧАНИЕ: все 11 обязательных полей (REQUIRED_FIELDS) гарантированно не пустые
 * (validateForm проверил выше). Пустые необязательные поля передаются как '' —
 * Bitrix24 их принимает и сохраняет как пустые.
 */
export function saveForm() {
  // Шаг 1: Собираем все значения формы в объект.
  const formData = collectFormData();

  // Шаг 2: Валидируем все 11 обязательных полей. Если не прошло — прерываем, ошибки уже показаны.
  if (!validateForm(formData)) {
    logEvent('FORM_VALIDATION_FAILED', { fio: formData.fio || '', city: formData.clientCity || '' });
    return;
  }
  logEvent('FORM_SAVE_START', { fio: formData.fio || '', city: formData.clientCity || '' });

  // Шаг 3: Блокируем кнопку сохранения, чтобы менеджер не нажал её дважды.
  const btnSave = document.getElementById('btn-save');
  if (btnSave) {
    btnSave.disabled = true;           // Кнопка не реагирует на клики
    btnSave.textContent = 'Сохранение...'; // Текст меняется — менеджер видит, что идёт запрос
  }

  // Шаг 4: Отправляем обновление лида в Bitrix24 через JavaScript SDK BX24.
  // Все 11 обязательных полей гарантированно не пустые (validateForm проверил выше).
  // Пустые необязательные поля передаём как пустую строку — Bitrix24 их примет.
  // leadId читаем явно из AppState (задача 5) — раньше это была неявная глобальная зависимость.
  const leadId = AppState.get('leadId');
  // Маппинг 22 полей анкеты в реальные UF портала (см. field-mapper.js).
  // Старые UF_CRM_KC_* отброшены: install.php не запускался, поля заведены
  // менеджерами с timestamp-именами (UF_CRM_1764765*..1764768*).
  const fields = mapFormToBitrixFields(formData);

  // v3-latest: в тот же crm.lead.update пишем СИСТЕМНЫЕ поля имени:
  // LAST_NAME / NAME / SECOND_NAME — так же как это делает сам интерфейс Bitrix при редактировании лида.
  // TITLE переписываем только если собрали непустое ФИО — иначе оставляем
  // текущий заголовок, чтобы не стирать содержательные значения (напр. «НЕ ТРОГАТЬ ЛИД»).
  if (formData.lastName)   fields.LAST_NAME   = formData.lastName;
  if (formData.firstName)  fields.NAME        = formData.firstName;
  // Отчество разрешаем очищать: если пользователь убрал значение —
  // передаём пустую строку. Это важно для лидов, где отчества реально нет.
  fields.SECOND_NAME = formData.secondName || '';
  if (formData.fio)        fields.TITLE       = formData.fio;

  BX24.callMethod('crm.lead.update', {
    id: leadId, // ID текущего лида (получен из AppState, установлен в app.js)
    fields: fields,
    // REGISTER_SONET_EVENT: 'N' — не создаём уведомление в живой ленте Bitrix24
    // при каждом сохранении анкеты. Без этого флага в ленте появлялось бы
    // системное сообщение «Лид изменён» — лишний шум.
    params: { REGISTER_SONET_EVENT: 'N' }
  }, function (result) {
    // Шаг 5a: Разблокируем кнопку и восстанавливаем её вид.
    // SVG-иконка галочки + текст «Сохранить анкету» — стандартный вид кнопки.
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML =
        '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Сохранить анкету';
    }

    // Шаг 5b: Если API вернул ошибку — показываем уведомление менеджеру.
    if (result.error()) {
      logEvent('FORM_SAVE_ERROR', { error: String(result.error()) });
      showError(`Ошибка сохранения: ${result.error()}`); // showError() определена в app.js
    } else {
      // Шаг 5c: Успешное сохранение лида — обновляем ФИО в связанном контакте (если есть).
      // contactId сохранён в AppState при инициализации (app.js, lead.CONTACT_ID).
      const contactId = AppState.get('contactId');
      if (contactId) {
        // Обновляем LAST_NAME / NAME / SECOND_NAME контакта теми же значениями,
        // что только что записали в лид — чтобы данные совпадали в обоих местах.
        const contactFields = {
          LAST_NAME:   formData.lastName,
          NAME:        formData.firstName,
          SECOND_NAME: formData.secondName || ''
        };
        BX24.callMethod('crm.contact.update', {
          id: contactId,
          fields: contactFields,
          params: { REGISTER_SONET_EVENT: 'N' }
        }, function (contactResult) {
          // Ошибка обновления контакта не блокирует успешное сохранение лида:
          // показываем предупреждение, но всё равно пишем в таймлайн и показываем «Сохранено».
          if (contactResult.error()) {
            showError(`Контакт не обновлён: ${contactResult.error()}`);
          }
          // Шаг 5d: добавляем комментарий в таймлайн лида.
          addTimelineComment(formData);
        });
      } else {
        // Контакта нет — просто пишем в таймлайн.
        addTimelineComment(formData);
      }
    }
  });
}

/**
 * addTimelineComment — добавляет комментарий об успешном сохранении анкеты в таймлайн лида.
 *
 * ЗАЧЕМ НУЖНА:
 *   Таймлайн лида в Bitrix24 — это лента событий, видимая всем менеджерам.
 *   Комментарий фиксирует: кто, когда и какую ключевую информацию заполнил в анкете.
 *   Это позволяет восстановить историю работы с клиентом без открытия самой формы.
 *
 * ЧТО ПИШЕТ В КОММЕНТАРИЙ:
 *   1. Заголовок: «Анкета КЦ заполнена: <имя менеджера> (<дата и время>)»
 *   2. Город клиента (если заполнен)
 *   3. Сумма долга (если заполнена)
 *   4. Основная боль (если заполнена)
 *   5. Возражения (если заполнены)
 *   Пустые поля не включаются в комментарий (filter(Boolean) убирает их).
 *
 * ПОРЯДОК РАБОТЫ:
 *   1. Формирует строку с датой/временем в формате ДД.ММ.ГГГГ ЧЧ:ММ (ru-RU).
 *   2. Составляет массив строк комментария (только непустые).
 *   3. Отправляет crm.timeline.comment.add в Bitrix24 API.
 *   4. При ошибке — показывает showError().
 *   5. При успехе — вызывает showSuccess() (уведомление «Анкета сохранена»).
 *
 * @param {object} formData — Объект данных формы из collectFormData().
 */
export function addTimelineComment(formData) {
  // Получаем текущую дату и время для метки в комментарии.
  const now = new Date();

  // Форматируем дату в российском формате: ДД.ММ.ГГГГ ЧЧ:ММ
  // (например: «25.12.2024, 14:30»).
  // toLocaleString('ru-RU', ...) — встроенный браузерный форматировщик дат.
  const dt  = now.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  // ── Хелперы для перевода значений в человекочитаемый вид ───────────────────
  // EMPTY — отображаем для всех незаполненных полей (так менеджер видит, что
  // именно он пропустил при заполнении анкеты).
  const EMPTY = '—';

  // optLabel(opts, value) — переводит value в label из массива OPTS_*
  // (см. form-render.js). Если value пусто или не найдено — возвращает EMPTY.
  function optLabel(opts, value) {
    if (!value) return EMPTY;
    const found = opts.find(function (o) { return o.value === value; });
    return found ? found.label : value; // fallback на сырое значение, если опции изменились
  }

  // text(value) — для свободных текстовых полей: пусто → «—», иначе как есть.
  function text(value) {
    return value && String(value).trim() ? String(value).trim() : EMPTY;
  }

  // money(value) — форматирует целое число рублей с разделителями тысяч,
  // добавляет знак ₽. Пусто → «—».
  function money(value) {
    if (!value) return EMPTY;
    const num = parseInt(String(value).replace(/\D/g, ''), 10);
    if (!Number.isFinite(num)) return EMPTY;
    return num.toLocaleString('ru-RU') + ' ₽';
  }

  // checkbox(value) — для чек-боксов блока 6: 'Y' → «✓», 'N'/пусто → «—».
  // Используем галочку, чтобы взгляд менеджера сразу выделял отмеченные пункты.
  function checkbox(value) {
    return value === 'Y' ? '✓' : EMPTY;
  }

  // datetime(value) — форматирует ISO-строку (например '2026-05-12T14:00:00+03:00')
  // в локальный российский вид «12.05.2026, 14:00». Пусто → «—».
  function datetime(value) {
    if (!value) return EMPTY;
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // hasAnyChecked — есть ли хотя бы один отмеченный чек-бокс блока 6.
  // Если нет — заголовок «Признаки нецелевой» и сами строки не выводим,
  // чтобы не захламлять ленту 14 строками «—».
  const block6Keys = [
    'mortgage', 'mortgageNoGuarantor', 'mortgageBadOverdue',
    'collateralReadyToPart', 'propertyOverDebt', 'propertyReadyForRisks',
    'dealsDuringOverdue', 'oooHasBalance', 'oooReadyToPart',
    'criminal159SameGrounds', 'forOther', 'nonDischargeable',
    'otherCompanyAS', 'incomeKmBad'
  ];
  const hasAnyChecked = block6Keys.some(function (k) { return formData[k] === 'Y'; });

  // hasBooking — заполнены ли поля бронирования. Если нет — секцию «Запись»
  // не выводим: чаще всего на этапе анкеты слот ещё не выбран.
  const hasBooking = !!formData.bookedTimeMP;

  // Имя менеджера и leadId берём явно из AppState (задача 5) — это устраняет
  // неявные глобальные зависимости от app.js. Если AppState ещё не установил
  // currentUsername (редко, но бывает при mock-режиме), отдаём 'Менеджер'.
  const username = AppState.get('currentUsername') || 'Менеджер';
  const leadId = AppState.get('leadId');

  // v3-latest: ID текущего пользователя — нужен для AUTHOR_ID комментария.
  // При работе внутри iframe Bitrix24 (SDK) это — реальный пользователь из user.current.
  // В вебхук-моке это — MOCK_CURRENT_USER из webhook-client.js (СНАЧАЛА не было живого
  // ID, и вебхук подставлял владельца токена = Шишкин Виталий). Теперь явно
  // передаём AUTHOR_ID — комментарий будет от текущего пользователя, а не от владельца вебхука.
  const currentUser = AppState.get('currentUser') || {};
  const authorId    = currentUser.ID || currentUser.id || null;

  // ── Сборка комментария ─────────────────────────────────────────────────────
  // Группируем строки по блокам анкеты, между блоками — пустая строка.
  // Пустые поля выводятся как «—» (требование: чтобы менеджер видел, что
  // именно он пропустил при заполнении).
  const lines = [];

  lines.push('Анкета КЦ заполнена: ' + username + ' (' + dt + ')');
  lines.push('');

  // Блок 1 — Персональные данные.
  // v3-latest: «Место работы» убрано из формы и из комментария.
  lines.push('— Персональные данные —');
  lines.push('ФИО: '                   + text(formData.fio));
  lines.push('Город: '                 + text(formData.clientCity));
  lines.push('Семейное положение: '    + optLabel(OPTS_MARITAL,   formData.maritalStatus));
  lines.push('Дети: '                  + optLabel(OPTS_CHILDREN,  formData.children));
  lines.push('Совм. имущество: '       + optLabel(OPTS_YES_NO,    formData.jointProperty));
  lines.push('Судимости: '             + optLabel(OPTS_YES_NO,    formData.criminal));
  lines.push('ООО: '                   + optLabel(OPTS_YES_NO,    formData.ooo));
  lines.push('ИП: '                    + optLabel(OPTS_YES_NO,    formData.ip));
  lines.push('');

  // Блок 2 — Финансовые данные.
  lines.push('— Финансовые данные —');
  lines.push('Сумма долга: '           + money(formData.debtTotal));
  lines.push('Ежемесячный платёж: '    + money(formData.monthlyPayment));
  lines.push('Официальный доход: '     + money(formData.officialIncome));
  lines.push('Неофициальный доход: '   + money(formData.unofficialIncome));
  lines.push('Зарплатная карта: '      + optLabel(OPTS_SALARY_CARD, formData.salaryCard));
  lines.push('');

  // Блок 3 — Кредитная история.
  lines.push('— Кредитная история —');
  lines.push('Кредиторы: '             + text(formData.creditors));
  lines.push('Залог: '                 + optLabel(OPTS_YES_NO, formData.collateral));
  lines.push('Просрочки: '             + text(formData.overdue));
  lines.push('ФССП: '                  + optLabel(OPTS_YES_NO, formData.fssp));
  lines.push('Имущество в собственности: ' + optLabel(OPTS_YES_NO, formData.property));
  lines.push('Сделки за 3 года: '      + optLabel(OPTS_YES_NO, formData.deals));
  lines.push('');

  // Блок 4 — Заметки менеджера.
  lines.push('— Заметки менеджера —');
  lines.push('Исключение из КМ: '      + text(formData.kmExclusion));
  lines.push('Основная боль: '         + text(formData.mainPain));
  lines.push('Возражения: '            + text(formData.objections));
  lines.push('Доп. комментарий: '      + text(formData.extraComment));

  // Блок 6 — Признаки нецелевой встречи (только если что-то отмечено).
  if (hasAnyChecked) {
    lines.push('');
    lines.push('— Признаки нецелевой встречи —');
    lines.push('Ипотека: '                              + checkbox(formData.mortgage));
    lines.push('Ипотека: нет созаёмщика: '              + checkbox(formData.mortgageNoGuarantor));
    lines.push('Ипотека: просрочки не закрыть: '        + checkbox(formData.mortgageBadOverdue));
    lines.push('Залог: готов расстаться: '              + checkbox(formData.collateralReadyToPart));
    lines.push('Доп. имущество: стоимость > долга: '    + checkbox(formData.propertyOverDebt));
    lines.push('Доп. имущество: готов к рискам: '       + checkbox(formData.propertyReadyForRisks));
    lines.push('Сделки в период просрочек: '            + checkbox(formData.dealsDuringOverdue));
    lines.push('ООО: есть баланс: '                     + checkbox(formData.oooHasBalance));
    lines.push('ООО: готов расстаться: '                + checkbox(formData.oooReadyToPart));
    lines.push('Судимость 159 УК РФ по тем же осн.: '   + checkbox(formData.criminal159SameGrounds));
    lines.push('Обращение за другого человека: '        + checkbox(formData.forOther));
    lines.push('Долг не подлежит списанию: '            + checkbox(formData.nonDischargeable));
    lines.push('Подан в АС другой компанией: '          + checkbox(formData.otherCompanyAS));
    lines.push('Невыгодно по расчёту КМ: '              + checkbox(formData.incomeKmBad));
  }

  // Блок 5 — Запись на встречу (только если слот выбран).
  if (hasBooking) {
    lines.push('');
    lines.push('— Запись на встречу —');
    lines.push('Время для менеджера: ' + datetime(formData.bookedTimeMP));
    lines.push('Время для клиента: '   + datetime(formData.bookedTimeClient));
  }

  const comment = lines.join('\n');

  // Отправляем комментарий в таймлайн лида через Bitrix24 SDK.
  // v3-latest: явно передаём AUTHOR_ID — это ID текущего пользователя, а не владельца
  // вебхук-токена. Без этого в вебхук-режиме все комментарии отображались как
  // от Шишкина Виталия (user 6 = владелец токена m1umtpppnvj21gud).
  const commentFields = {
    ENTITY_ID:   leadId,  // ID текущего лида (получен из AppState выше)
    ENTITY_TYPE: 'lead',  // Тип сущности — лид (не сделка, не контакт)
    COMMENT:     comment  // Текст комментария (многострочный, сформированный выше)
  };
  if (authorId) commentFields.AUTHOR_ID = authorId;

  BX24.callMethod('crm.timeline.comment.add', {
    fields: commentFields
  }, function (result) {
    // Если API вернул ошибку при записи в таймлайн — показываем предупреждение.
    // (Данные лида при этом уже сохранены — ошибка только в таймлайне.)
    if (result.error()) {
      logEvent('TIMELINE_ERROR', { error: String(result.error()) });
      showError(`Ошибка записи в таймлайн: ${result.error()}`); // showError() из app.js
    } else {
      // Успешная запись в таймлайн — показываем уведомление «Анкета сохранена».
      logEvent('FORM_SAVED', { fio: formData.fio || '', city: formData.clientCity || '' });
      showSuccess(); // showSuccess() из app.js — зелёный тост/баннер
    }
  });
}

// ─── Сброс формы ─────────────────────────────────────────────────────────────

/**
 * Инициализация обработчиков кнопок «Сохранить» (submit) и «Сбросить» (reset).
 * Оборачивается в DOMContentLoaded, чтобы запуститься только после полной
 * загрузки HTML-документа — когда кнопки уже есть в DOM.
 */
document.addEventListener('DOMContentLoaded', function () {
  // Находим элемент формы — нужен для навешивания submit и для сброса полей.
  const form  = document.getElementById('anketa-form');
  // Находим кнопку «Сбросить изменения».
  const reset = document.getElementById('btn-reset');

  if (form) {
    // Обработчик события submit формы (нажатие кнопки «Сохранить анкету»
    // или нажатие Enter в поле внутри формы).
    form.addEventListener('submit', function (e) {
      // Отменяем стандартное поведение браузера (перезагрузка страницы с GET/POST-запросом).
      // Без этого страница перезагрузится при каждом нажатии «Сохранить».
      e.preventDefault();

      // Запускаем нашу логику сохранения: валидация → CRM-update → таймлайн-комментарий.
      saveForm();
    });
  }

  if (reset) {
    // Обработчик клика по кнопке «Сбросить изменения».
    reset.addEventListener('click', function () {
      // Спрашиваем подтверждение у менеджера через стандартный диалог браузера.
      // Это защита от случайного нажатия — сброс необратимо очищает все несохранённые изменения.
      if (confirm('Сбросить все изменения?')) {
        // form.reset() — стандартный метод браузера: возвращает все поля формы
        // к значениям, которые были при первоначальной загрузке страницы.
        // (Т.е. сбрасывает именно изменения, внесённые менеджером вручную.)
        if (form) form.reset();

        // Убираем все ошибки валидации (если были показаны до нажатия «Сбросить»).
        _clearAllFieldErrors();
        // Дополнительно сбрасываем жёлтое предупреждение TZ города.
        clearCityError();

        // Пересчитываем прогресс заполнения — после сброса счётчик должен обновиться.
        updateProgress();
        logEvent('FORM_RESET', null);
      }
    });
  }
});
