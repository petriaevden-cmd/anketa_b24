/**
 * form-init.js — инициализация формы данными лида.
 *
 * Содержит initForm(lead), updateProgress(), _setGrid(id),
 * updateTargetStatusWidget() и связанные обработчики change/input
 * для пересчёта прогресса и виджета статуса.
 *
 * Зависит от form-render.js (все field* функции и OPTS_* константы)
 * и target-status.js (через window.TargetStatus).
 */

import {
  fieldText, fieldNumber, fieldSelect, fieldTextarea, fieldCheckbox, fieldCity,
  escHtml, attachMoneyMask,
  OPTS_YES_NO, OPTS_SALARY_CARD,
  OPTS_MARITAL, OPTS_CHILDREN
} from './form-render.js';
// collectFormData нужна updateTargetStatusWidget — импортируем из form-submit.js.
import { collectFormData, clearCityError } from './form-submit.js';
import { setClientCity } from './slots.js';

// ─── Инициализация формы ─────────────────────────────────────────────────────

/**
 * _setGrid — вспомогательная функция: применяет CSS-классы двухколоночной сетки (grid)
 * к блоку-контейнеру полей формы.
 *
 * Используется перед заполнением каждого блока (personal-body, finance-body и т.д.),
 * чтобы поля внутри автоматически выравнивались в 2 колонки.
 *
 * Стили:
 *   px-3 py-2       — горизонтальные и вертикальные отступы от краёв блока
 *   grid            — включаем CSS Grid Layout
 *   grid-cols-2     — два равных столбца
 *   gap-x-3 gap-y-2 — горизонтальный отступ 12px между колонками, 8px между строками
 *   text-xs         — базовый размер шрифта внутри блока (12px)
 *
 * @param {string} id — id элемента-контейнера (<div id="personal-body">, <div id="finance-body"> и т.д.)
 */
export function _setGrid(id) {
  const el = document.getElementById(id); // Находим DOM-элемент по id
  // Используем `className =`, а не `classList.add`: при повторной инициализации
  // формы (например, при сбросе и повторном открытии того же лида) classList.add
  // дублировал бы grid-классы — Tailwind стерпел бы, но любой инспектор DOM
  // показал бы кашу, и отладка стала бы сложнее. Полная перезапись className
  // делает рендер идемпотентным: после initForm разметка одинаковая независимо
  // от того, в каком состоянии был блок до этого.
  if (el) el.className = 'px-3 py-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs';
}

/**
 * initForm — главная функция инициализации формы.
 * Вызывается из app.js сразу после загрузки данных лида из Bitrix24.
 * Заполняет все 5 блоков формы сгенерированным HTML и навешивает обработчик города.
 *
 * ПОРЯДОК РАБОТЫ:
 *   1. Собирает ФИО из трёх отдельных полей лида (фамилия + имя + отчество).
 *   2. Рендерит БЛОК 1 «Персональные данные» (9 полей).
 *   3. Навешивает обработчики события на поле города (change + input).
 *   4. Рендерит БЛОК 2 «Финансовые данные» (5 полей).
 *   5. Рендерит БЛОК 3 «Кредитная история» (6 полей).
 *   6. Рендерит БЛОК 4 «Заметки менеджера» (4 textarea).
 *   7. Вызывает updateProgress() для первичного расчёта заполненности.
 *
 * @param {object} lead — Объект лида из Bitrix24 API (crm.lead.get),
 *   содержит поля: LAST_NAME, NAME, SECOND_NAME и числовые UF_CRM_<ID>
 *   пользовательские поля (см. field-mapper.js для актуальных ID).
 */
export function initForm(lead) {
  // Сокращённый псевдоним для объекта лида — удобнее писать f.FIELD, чем lead.FIELD.
  const f   = lead;

  // Собираем полное ФИО из трёх отдельных полей лида.
  // filter(Boolean) удаляет пустые/null/undefined значения,
  // чтобы не получилось лишних пробелов при отсутствии отчества.
  // Пример: ['Иванов', 'Иван', ''] → ['Иванов', 'Иван'] → 'Иванов Иван'
  const fio = [f.LASTNAME, f.NAME, f.SECONDNAME].filter(Boolean).join(' ');

  // ── БЛОК 1: Персональные данные ──────────────────────────────────────────
  // Раскладка полей в 2-колоночной сетке:
  //   Строка 1: Фамилия | Имя
  //   Строка 2: Отчество | (пустая ячейка)
  //   Строка 3: Город | Семейное положение
  //   Строка 4: Дети | Совм. имущество
  //   Строка 5: Судимости | ООО
  //   Строка 6: ИП | (пустая ячейка)
  //
  // v3-latest: ФИО разбито на 3 редактируемых поля. При сохранении эти поля
  // пишутся в системные LAST_NAME/NAME/SECOND_NAME лида + собранный TITLE.
  // Поле «Место работы» убрано из UI (UF в Bitrix остаётся — не трогаем).
  // Переменная `fio` (склейка для совместимости) больше не нужна для рендера,
  // оставляем её только для подавления варнинга о неиспользуемой переменной.
  void fio;

  // Применяем CSS-классы двухколоночной сетки к контейнеру блока персональных данных.
  _setGrid('personal-body');

  // Заполняем innerHTML блока HTML-кодом всех полей, соединяя строки через +.
  document.getElementById('personal-body').innerHTML =
    // Фамилия / Имя / Отчество — редактируемые поля. При сохранении
    // пишутся в системные поля лида (LAST_NAME, NAME, SECOND_NAME) и
    // в собранный TITLE («Фамилия Имя Отчество»). Подробности маппинга
    // см. в form-submit.js → saveForm().
    fieldText   ('f-last-name',      'Фамилия',     f.LAST_NAME    || f.LASTNAME    || '', { placeholder: 'Иванов' }) +
    fieldText   ('f-first-name',     'Имя',         f.NAME                            || '', { placeholder: 'Иван' }) +
    fieldText   ('f-second-name',    'Отчество',    f.SECOND_NAME  || f.SECONDNAME  || '', { placeholder: 'Иванович' }) +

    // Город клиента — специальное поле с автодополнением и привязкой к часовому поясу (см. fieldCity).
    fieldCity   ('f-client-city', 'Город клиента', f.UF_CRM_1521214081) +

    // Семейное положение — выпадающий список (влияет на совместное имущество при банкротстве).
    fieldSelect ('f-marital',         'Семейное положение', f.UF_CRM_1764767738244,   OPTS_MARITAL) +

    // Дети — выпадающий список (влияет на расчёт прожиточного минимума).
    fieldSelect ('f-children',        'Дети',               f.UF_CRM_1764767804861,         OPTS_CHILDREN) +

    // Совместное имущество — есть ли имущество, нажитое совместно с супругом/ой.
    fieldSelect ('f-joint-property',  'Совм. имущество',   f.UF_CRM_1764767768332,   OPTS_YES_NO) +

    // Судимости — наличие судимостей влияет на возможность прохождения банкротства.
    fieldSelect ('f-criminal',        'Судимости',          f.UF_CRM_1764767860124,         OPTS_YES_NO) +

    // ООО — является ли клиент учредителем/директором ООО (риск субсидиарной ответственности).
    fieldSelect ('f-ooo',             'ООО',                f.UF_CRM_1764767873758,              OPTS_YES_NO) +

    // ИП — зарегистрирован ли клиент как индивидуальный предприниматель.
    fieldSelect ('f-ip',              'ИП',                 f.UF_CRM_1764767897075,               OPTS_YES_NO);

  // ── Обработчик поля «Город» ───────────────────────────────────────────────
  // После вставки HTML в DOM находим элемент поля города.
  const cityEl = document.getElementById('f-client-city');

  if (cityEl) {
    // Внутренняя функция-обработчик, вызывается при любом изменении поля города.
    function _onCityChange() {
      // Сбрасываем ошибку валидации (красную рамку и текст «Укажите город»),
      // т.к. менеджер уже начал вводить значение.
      clearCityError();

      // Получаем текущее значение поля без лишних пробелов по краям.
      const val = cityEl.value.trim();

      // Баг 7 fix: проверяем, есть ли введённый город в справочнике CITIES_TZ.
      // Если города нет в справочнике — показываем жёлтое предупреждение,
      // что часовой пояс не определится автоматически.
      const warnEl = document.getElementById('f-client-city-tz-warn');
      if (warnEl) {
        // known = true, если: поле пустое (нечего проверять) ИЛИ город найден в CITIES_TZ.
        // known = false, если: в поле что-то есть, но этого города нет в CITIES_TZ.
        const known = (!val) || (typeof CITIES_TZ !== 'undefined' && CITIES_TZ[val] !== undefined);
        // toggle('hidden', true) — скрывает элемент; toggle('hidden', false) — показывает.
        warnEl.classList.toggle('hidden', known);
      }

      // Вызываем setClientCity() из calendar.js, если она доступна.
      // Это обновляет часовой пояс в блоке расписания прямо при вводе города,
      // не дожидаясь сохранения формы.
      setClientCity(val);
    }

    // Навешиваем обработчик на два события:
    //   'change' — срабатывает при выборе из datalist или при потере фокуса (blur + изменение).
    //   'input'  — срабатывает при каждом нажатии клавиши во время набора текста.
    // Оба нужны, чтобы предупреждение и TZ обновлялись как при выборе, так и при ручном вводе.
    cityEl.addEventListener('change', _onCityChange);
    cityEl.addEventListener('input',  _onCityChange);
  }

  // ── БЛОК 2: Финансовые данные ─────────────────────────────────────────────
  // 5 полей в 2 колонках:
  //   Строка 1: Долг | Платёж/мес
  //   Строка 2: Офиц. доход | Неофиц. доход
  //   Строка 3: Зарпл. карта | (пустая ячейка)

  // Применяем CSS-классы сетки к контейнеру блока финансовых данных.
  _setGrid('finance-body');

  document.getElementById('finance-body').innerHTML =
    // Общая сумма долга в рублях. min: 0 — запрет отрицательных значений.
    fieldNumber ('f-debt-total',        'Долг, ₽',              f.UF_CRM_1764765055684,        { placeholder: '0', min: 0 }) +

    // Ежемесячный платёж по всем кредитам/займам. min: 0 — запрет отрицательных значений.
    fieldNumber ('f-monthly-payment',   'Платёж/мес, ₽',         f.UF_MONTHLY_PAYMENT,   { placeholder: '0', min: 0 }) +

    // Официальный доход в рублях (вместо enum-выбора). min: 0 — запрет отрицательных значений.
    fieldNumber ('f-official-income',   'Офиц. доход, ₽',       f.UF_OFFICIAL_INCOME,   { placeholder: '0', min: 0 }) +

    // Неофициальный доход в рублях (подработки, «серые» выплаты и т.п.). min: 0.
    fieldNumber ('f-income-unofficial', 'Неофиц. доход, ₽',     f.UF_UNOFFICIAL_INCOME, { placeholder: '0', min: 0 }) +

    // Зарплатная карта — в каком банке поступает основная зарплата.
    fieldSelect ('f-salary-card',       'Зарпл. карта',          f.UF_CRM_1764767677345,       OPTS_SALARY_CARD);

  // v3-latest: после рендера финансового блока навешиваем маску тысячных разрядов
  // на все денежные поля (отмечены data-money="1"). Маска показывает «60 000» в
  // input.value (с U+202F), а чистое число хранит в input.dataset.raw — именно
  // его читает collectFormData() и далее передаёт в mapFormToBitrixFields → toMoney.
  attachMoneyMask(document.getElementById('finance-body'));

  // ── БЛОК 3: Кредитная история ─────────────────────────────────────────────
  // 6 полей в 2 колонках:
  //   Строка 1: Кредиторы (col-span-2, вся строка)
  //   Строка 2: Залог | Просрочки
  //   Строка 3: ФССП | Имущество
  //   Строка 4: Сделки | (пустая ячейка)

  // Применяем CSS-классы сетки к контейнеру блока кредитной истории.
  _setGrid('credit-body');

  document.getElementById('credit-body').innerHTML =
    // Кредиторы — перечисление банков, МФО и других организаций, которым должен клиент.
    // colSpan: true — поле занимает всю строку (много текста).
    fieldText   ('f-creditors',  'Кредиторы',  f.UF_CRM_1764765826044,  { colSpan: true, placeholder: 'Банки, МФО...' }) +

    // Залог — есть ли залоговое имущество по кредитам (ипотека, автокредит и т.п.).
    fieldSelect ('f-collateral', 'Залог',      f.UF_DEPOSIT, OPTS_YES_NO) +

    // Просрочки — текстовое описание: сколько дней просрочки и по каким кредитам.
    fieldText   ('f-overdue',    'Просрочки',  f.UF_CRM_1764767202050,    { placeholder: 'дней / описание' }) +

    // ФССП — есть ли исполнительные производства в Федеральной службе судебных приставов.
    fieldSelect ('f-fssp',       'ФССП',       f.UF_CRM_1764767243083,       OPTS_YES_NO) +

    // Имущество — есть ли у клиента имущество в собственности (недвижимость, авто и т.п.).
    fieldSelect ('f-property',   'Имущество',  f.UF_POSSESSIONS,   OPTS_YES_NO) +

    // Сделки — совершал ли клиент сделки по отчуждению имущества за последние 3 года
    // (продажа, дарение). Важно для оспаривания сделок при банкротстве.
    fieldSelect ('f-deals',      'Сделки',     f.UF_DEALS,      OPTS_YES_NO);

  // ── БЛОК 4: Заметки менеджера ─────────────────────────────────────────────
  // 4 textarea в 2 колонках (каждый занимает 1 колонку — два в ряд):
  //   Строка 1: Исключение из КМ | Основная боль
  //   Строка 2: Возражения | Доп. комментарий

  // Применяем CSS-классы сетки к контейнеру блока заметок.
  _setGrid('manager-body');

  document.getElementById('manager-body').innerHTML =
    // Исключение из КМ — причины, по которым клиент не подходит для кредитного менеджера.
    fieldTextarea('f-km-exclusion',  'Исключение из КМ', f.UF_CRM_1764767905632,  { placeholder: 'Причина...' }) +

    // Основная боль клиента — главная проблема/мотивация обращения.
    fieldTextarea('f-main-pain',     'Основная боль',    f.UF_CRM_1764767920445,     { placeholder: 'Главная проблема...' }) +

    // Возражения клиента — что мешает принять решение, сомнения, опасения.
    fieldTextarea('f-objections',    'Возражения',       f.UF_CRM_1764767933689,    { placeholder: 'Возражения клиента...' }) +

    // Дополнительный комментарий — любая прочая важная информация о клиенте.
    fieldTextarea('f-extra-comment', 'Доп. комментарий', f.UF_CRM_1764767947408, { placeholder: 'Доп. информация...' });

  // ── БЛОК 5: Признаки нецелевой встречи ────────────────────────────
  //
  // Блок реализует уточняющие флажки из «Стандарта НЕЦЕЛЕВОЙ встречи».
  // Чек-боксы ХРАНЯТСЯ ТОЛЬКО В JS-СОСТОЯНИИ (formData) и НЕ ПЕРЕДАЮТСЯ
  // в crm.lead.update — на портале специальных полей под них нет и создавать
  // их без явного подтверждения пользователя запрещено. Итоговый статус
  // «Целевой/Нецелевой» передаётся в БП 40 (calendar.js).
  //
  // Раскладка — 2 колонки. Некоторые флажки растянуты на 2 колонки (длинные метки).

  // Если контейнер блока присутствует в DOM (добавляется в index.php) — рендерим флажки.
  // Для обратной совместимости: если контейнера нет — просто пропускаем блок.
  if (document.getElementById('netselevoi-body')) {
    // v3-latest: контейнер блока 5 теперь — flex-column, чтобы каждый
    // подраздел занимал всю ширину и имел собственную внутреннюю 2-колоночную
    // сетку. Это даёт визуальное разделение «по темам», как просил заказчик:
    // 1) Ипотека и залог, 2) Имущество и сделки, 3) ООО и предпринимательство,
    // 4) Юридические риски, 5) Прочее.
    const netselEl = document.getElementById('netselevoi-body');
    netselEl.className = 'px-3 py-2 flex flex-col gap-3 text-xs';

    // Хелпер: блок одного подраздела с заголовком и внутренней 2-колоночной сеткой
    // для чек-боксов. Заголовок выделен мелким жирным текстом серо-синего цвета,
    // снизу — тонкая разделительная линия (border-b), чтобы подразделы читались.
    function section(title, body) {
      return `
        <section class="flex flex-col gap-1">
          <h4 class="text-[13px] font-semibold text-gray-700 uppercase tracking-wide
                     border-b border-gray-200 pb-1 mb-1">${escHtml(title)}</h4>
          <div class="grid grid-cols-2 gap-x-3 gap-y-1">${body}</div>
        </section>`;
    }

    netselEl.innerHTML =
      // —— Раздел 1: Ипотека и залог ——
      // Базовый флажок «Есть ипотека» + 2 риска по ипотеке + флажок по залогу.
      // Правило «collateral_not_ready»: залог=Y, НЕ ипотека, флажок СНЯТ → нецелевой.
      section('Ипотека и залог',
        fieldCheckbox('f-mortgage',                'Есть ипотека',                                                false, { colSpan: true }) +
        fieldCheckbox('f-mortgage-no-guarantor',   'Ипотека: нет созаёмщика/поручителя',                          false) +
        fieldCheckbox('f-mortgage-bad-overdue',    'Ипотека: просрочки не закрыть',                                false) +
        fieldCheckbox('f-collateral-ready-to-part', 'Залог: готов расстаться с имуществом',                       false, { colSpan: true, hint: 'Если НЕ отмечено и «Залог»=Да (не ипотека) — нецелевой' })
      ) +

      // —— Раздел 2: Имущество и сделки ——
      // Правило «extra_property_overprice_or_no_risks»: property=Y и один из флажков.
      // Правило «deals_during_overdue»: deals=Y и флажок ОТМЕЧЕН.
      section('Имущество и сделки',
        fieldCheckbox('f-property-over-debt',       'Доп. имущество: стоимость > сумма долга',                     false) +
        fieldCheckbox('f-property-ready-for-risks', 'Доп. имущество: готов к рискам реализации',                  false, { hint: 'Если НЕ отмечено и property=Да — нецелевой' }) +
        fieldCheckbox('f-deals-during-overdue',     'Сделки совершены в период просрочек',                         false, { colSpan: true })
      ) +

      // —— Раздел 3: ООО и предпринимательство ——
      // Правило «ooo_with_balance_and_not_ready»: ooo=Y, «есть баланс»=Y и «готов»=N.
      section('ООО и предпринимательство',
        fieldCheckbox('f-ooo-has-balance',          'ООО: есть баланс ≈ сумме долга',                              false) +
        fieldCheckbox('f-ooo-ready-to-part',        'ООО: готов расстаться с организацией',                        false, { hint: 'Если НЕ отмечено и «баланс»=Да — нецелевой' })
      ) +

      // —— Раздел 4: Юридические риски ——
      // Правила: criminal_159_same_grounds, non_dischargeable_debt,
      // other_company_in_arbitration.
      section('Юридические риски',
        fieldCheckbox('f-criminal-159-same',        'Судимость 159 УК РФ по тем же основаниям (непогашенная)',     false, { colSpan: true }) +
        fieldCheckbox('f-non-dischargeable',        'Долг не подлежит списанию (алименты/субсидиарка/ущерб)',     false, { colSpan: true }) +
        fieldCheckbox('f-other-company-as',         'Уже подан в АС другой компанией',                              false, { colSpan: true })
      ) +

      // —— Раздел 5: Прочее ——
      // Обращение за другого + высокий доход / невыгодный расчёт КМ.
      section('Прочее',
        fieldCheckbox('f-for-other',                'Обращение за другого человека',                                false, { colSpan: true }) +
        fieldCheckbox('f-income-km-bad',            'Невыгодно по расчёту КМ (высокий доход/льготы)',              false, { colSpan: true })
      );
  }

  // После рендера всех полей — первичный расчёт статуса «Целевой/Нецелевой»,
  // чтобы виджет-индикатор отображал актуальное состояние с момента открытия формы.
  updateTargetStatusWidget();

  // После рендера всех полей — пересчитываем прогресс заполнения формы.
  // Это нужно для корректного отображения полосы прогресса при инициализации,
  // когда часть полей уже заполнена данными из лида.
  updateProgress();
}

// ─── Прогресс заполнения ─────────────────────────────────────────────────────

/**
 * updateProgress — пересчитывает и отображает прогресс заполнения формы.
 *
 * КАК РАБОТАЕТ:
 *   1. Находит все редактируемые поля внутри формы (#anketa-form):
 *      input (кроме readonly), select, textarea.
 *   2. Считает, сколько из них не пустые (filled).
 *   3. Вычисляет процент: filled / total * 100.
 *   4. Обновляет ширину полосы прогресса (#progress-bar).
 *   5. Обновляет текстовый счётчик (#progress-label), например «12 / 22».
 *
 * Вызывается:
 *   - initForm() — при первичном рендере формы с данными лида.
 *   - Обработчик 'change' на документе — при каждом изменении любого поля.
 *   - btn-reset (сброс формы) — чтобы счётчик сбросился вместе с полями.
 */
export function updateProgress() {
  // Находим элемент формы по id.
  const form = document.getElementById('anketa-form');
  // Если форма не найдена (страница ещё не загружена) — выходим без ошибки.
  if (!form) return;

  // Выбираем все редактируемые поля формы:
  //   input:not([readonly]) — текстовые и числовые поля, кроме ФИО (readonly)
  //   select                — выпадающие списки
  //   textarea              — многострочные текстовые поля
  const inputs = form.querySelectorAll('input:not([readonly]),select,textarea');

  // Счётчик заполненных полей.
  let filled = 0;

  // Перебираем все найденные поля.
  inputs.forEach(function(el) {
    // Поле считается заполненным, если его значение не пустое (после trim — без пробелов).
    if (el.value && el.value.trim() !== '') filled++;
  });

  // Общее количество полей для заполнения.
  const total = inputs.length;

  // Вычисляем процент: если полей нет — 0%, иначе округляем до целого.
  const pct   = total ? Math.round((filled / total) * 100) : 0;

  // Находим DOM-элементы полосы и счётчика.
  const bar   = document.getElementById('progress-bar');
  const lbl   = document.getElementById('progress-label');

  // Устанавливаем ширину полосы прогресса в процентах (например '68%').
  if (bar) bar.style.width = `${pct}%`;

  // Показываем счётчик «заполнено / всего» (например '15 / 22').
  if (lbl) lbl.textContent = `${filled} / ${total}`;
}

// Глобальный обработчик события 'change' на уровне документа.
// При любом изменении поля внутри #anketa-form пересчитывает прогресс.
// Использует event delegation: навешивается один раз на document,
// а не на каждое поле отдельно — эффективнее и работает даже для динамически
// созданных полей (они появляются в DOM позже через innerHTML).
document.addEventListener('change', function(e) {
  // e.target.closest('#anketa-form') — проверяем, что событие произошло
  // внутри формы #anketa-form (а не в другом месте страницы).
  if (e.target.closest('#anketa-form')) updateProgress();
});

// ─── Виджет статуса «Целевой/Нецелевой» ──────────────────────────

/**
 * updateTargetStatusWidget — пересчитывает статус «Целевой/Нецелевой/
 * Не определено» по текущим данным формы и обновляет виджет-индикатор
 * в блоке «Признаки нецелевой встречи».
 *
 * ЛОГИКА:
 *   1. Собирает данные формы через collectFormData().
 *   2. Вызывает TargetStatus.evaluate(formData) из target-status.js.
 *   3. Сохраняет результат в window.__targetStatus — используется в
 *      calendar.js для передачи в БП и в timeline-комментарий.
 *   4. Обновляет DOM-элементы виджета:
 *      - #target-status-badge — бейдж с лейблом и цветом по статусу:
 *         зелёный — Целевой, красный — Нецелевой, жёлтый — Не определено.
 *      - #target-status-reasons — список причин (сработавших правил).
 *
 * Эти элементы присутствуют в разметке блока «Признаки нецелевой» в index.php.
 * Если их нет — функция безопасно пропускает обновление (работает в симуляторе).
 */
export function updateTargetStatusWidget() {
  // Если модуль target-status.js не подключён — выходим без ошибки.
  // Это обеспечивает обратную совместимость, если файл подключён не везде.
  if (typeof window.TargetStatus === 'undefined' ||
      typeof window.TargetStatus.evaluate !== 'function') {
    return;
  }

  // Посчитать статус по текущим данным формы.
  const formData = collectFormData();
  const status   = window.TargetStatus.evaluate(formData);

  // Используем именно глобальный объект window.__targetStatus, а не CustomEvent
  // и не параметр функции: calendar.js читает статус синхронно прямо перед
  // вызовом bizproc.workflow.start, и к этому моменту любое событие уже
  // «улетело бы» — обработчик обновления статуса успел отработать раньше,
  // и calendar.js не увидел бы свежего значения. Глобальное «зеркало»
  // последнего пересчёта надёжнее: какой бы вход ни запустил БП, он всегда
  // получит актуальный status.id, посчитанный по последнему изменению формы.
  window.__targetStatus = status;

  // Обновляем бейдж (цвет + лейбл).
  const badgeEl = document.getElementById('target-status-badge');
  if (badgeEl) {
    // Базовые классы бейджа в стиле Flowbite (https://flowbite.com/docs/components/badge/).
    const baseCls = 'inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium';
    // Цветовая схема по статусу — стандартные Tailwind/Flowbite классы.
    let colorCls = 'bg-yellow-100 text-yellow-800'; // Не определено (жёлтый).
    if (status.id === window.TargetStatus.IDS.TARGET) {
      colorCls = 'bg-green-100 text-green-800'; // Целевой (зелёный).
    } else if (status.id === window.TargetStatus.IDS.NON_TARGET) {
      colorCls = 'bg-red-100 text-red-800'; // Нецелевой (красный).
    }
    badgeEl.className   = `${baseCls} ${colorCls}`;
    badgeEl.textContent = status.label;
  }

  // Обновляем список причин (виден только если есть хотя бы одна).
  const reasonsEl = document.getElementById('target-status-reasons');
  if (reasonsEl) {
    if (status.reasons && status.reasons.length > 0) {
      // Рендерим как <ul> с пулями. escHtml() защищает от XSS.
      const items = status.reasons.map(function (r) {
        return `<li>${escHtml(r)}</li>`;
      }).join('');
      reasonsEl.innerHTML = `<ul class="list-disc list-inside space-y-0.5 text-[11px] text-gray-600">${items}</ul>`;
      reasonsEl.classList.remove('hidden');
    } else {
      // Причин нет («Целевой» без сработавших правил) — скрываем блок.
      reasonsEl.innerHTML = '';
      reasonsEl.classList.add('hidden');
    }
  }
}

// Делегированный обработчик 'change'/'input' на самой форме — пересчёт виджета
// статуса при любом изменении поля внутри #anketa-form. Использует event delegation,
// чтобы работало и для динамически вставленных в DOM чек-боксов (innerHTML в initForm).
// Оба события нужны: 'change' — для чек-боксов/селектов, 'input' — для текстовых полей
// (изменение долга или дохода должно сразу обновлять индикатор).
document.addEventListener('change', function (e) {
  if (e.target.closest('#anketa-form')) updateTargetStatusWidget();
});
document.addEventListener('input', function (e) {
  if (e.target.closest('#anketa-form')) updateTargetStatusWidget();
});

