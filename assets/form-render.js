/**
 * form-render.js — рендер HTML-полей формы (Tailwind + Flowbite).
 *
 * Содержит escHtml() и функции fieldText/fieldNumber/fieldSelect/fieldTextarea/
 * fieldCheckbox/fieldCity, которые возвращают строки HTML-разметки.
 * Также экспортирует константы OPTS_* — варианты для enumeration-полей.
 *
 * Файл является ES-модулем: ничего не делает с DOM, только производит строки —
 * что позволяет легко покрывать функции unit-тестами.
 *
 * Ниже идёт исходный JSDoc-блок form.js — он сохранён как референс
 * логической структуры анкеты (27 полей по 5 блокам). Имена вида
 * KC_* ниже — это логические псевдонимы; реальные коды
 * UF_CRM_<ID> см. в field-mapper.js.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * form.js — главный модуль логики формы анкеты клиента КЦ (Контакт-Центр).
 *
 * Отвечает за:
 *   1. Генерацию HTML-разметки полей формы (рендер через Tailwind CSS 4 + Flowbite).
 *   2. Заполнение всех 5 блоков формы данными из текущего лида Bitrix24.
 *   3. Валидацию 11 обязательных полей перед сохранением (REQUIRED_FIELDS).
 *   4. Сбор значений всех полей формы в единый объект.
 *   5. Сохранение данных в CRM через API Bitrix24 (crm.lead.update).
 *   6. Запись итогового комментария в таймлайн лида (crm.timeline.comment.add).
 *   7. Отображение прогресса заполнения формы (полоска + счётчик).
 *   8. Обработку кнопок «Сохранить» и «Сбросить».
 *
 * Поля анкеты (27 логических полей, распределённых по 5 блокам, реальные
 * имена UF-полей Bitrix24 — в field-mapper.js):
 *
 * БЛОК 1 — Персональные данные:
 *   1.  KC_FULLNAME           (string)      — ФИО (авто из лида)
 *   2.  KC_CLIENT_CITY        (string)      — Город клиента (→ TZ для расписания) [REQUIRED]
 *   3.  KC_WORKPLACE          (string)      — Место работы
 *   4.  KC_MARITAL_STATUS     (enumeration) — Семейное положение
 *   5.  KC_CHILDREN           (enumeration) — Дети
 *   6.  KC_JOINT_PROPERTY     (enumeration) — Совместное имущество
 *   7.  KC_CRIMINAL           (enumeration) — Судимости
 *   8.  KC_OOO                (enumeration) — ООО
 *   9.  KC_IP                 (enumeration) — ИП
 *
 * БЛОК 2 — Финансовые данные:
 *   10. KC_DEBT_TOTAL         (integer)     — Общая сумма долга
 *   11. KC_MONTHLY_PAYMENT    (integer)     — Ежемесячный платёж
 *   12. KC_INCOME_OFFICIAL    (enumeration) — Официальный доход
 *   13. KC_INCOME_UNOFFICIAL  (integer)     — Неофициальный доход
 *   14. KC_SALARY_CARD        (enumeration) — Зарплатная карта
 *
 * БЛОК 3 — Кредитная история:
 *   15. KC_CREDITORS          (string)      — Кредиторы
 *   16. KC_COLLATERAL         (enumeration) — Залог
 *   17. KC_OVERDUE            (string)      — Просрочки
 *   18. KC_FSSP               (enumeration) — ФССП
 *   19. KC_PROPERTY           (enumeration) — Имущество
 *   20. KC_DEALS              (enumeration) — Сделки
 *
 * БЛОК 4 — Заметки менеджера:
 *   21. KC_KM_EXCLUSION       (string)      — Исключение из КМ
 *   22. KC_MAIN_PAIN          (string)      — Основная боль
 *   23. KC_OBJECTIONS         (string)      — Возражения
 *   24. KC_EXTRA_COMMENT      (string)      — Доп. комментарий
 *
 * БЛОК 5 — Запись:
 *   25. KC_BOOKED_MANAGER     (employee)    — ID менеджера
 *   26. KC_BOOKED_TIME        (datetime)    — Время записи
 *   27. KC_BOOKED_EVENT_ID    (integer)     — ID события календаря
 */

// Включаем строгий режим JavaScript: запрещает использование необъявленных переменных,
// ловит типичные ошибки, делает код предсказуемее и безопаснее.
'use strict';

// ─── Вспомогательные функции рендера (Tailwind + Flowbite) ───────────────────
//
// Все функции ниже возвращают строку HTML-разметки для одного поля формы.
// Они НЕ вставляют HTML в DOM сами — вызывающий код (initForm) собирает
// все строки вместе и записывает их в innerHTML нужного блока.
//
// Стили (классы) берутся из Tailwind CSS 4 и библиотеки Flowbite.
// Каждое поле оборачивается в <div class="flex flex-col gap-0.5">,
// чтобы метка (label) и сам ввод шли строго сверху вниз с небольшим отступом.

// === Хелперы маски тысячных разрядов для денежных полей ===
//
// Пользователь видит «60 000» (с неразрывным пробелом U+202F),
// но в collectFormData() попадает чистая цифровая строка «60000».
// Разделитель U+202F выбран по рекомендации «Росстандарт Р 7.0.97-2016»
// и ICU/CLDR ru-RU: это визуально разрежённый пробел, который не переносит
// число на новую строку и не используется в стандартном вводе с клавиатуры.

/**
 * _digitsOnly — вернёт только цифры из value (без знаков, пробелов, '|RUB').
 * Принимает число, строку, undefined, null — всё приводит к String().
 * Используется и при рендере (очистить value), и в собрытии input.
 */
export function _digitsOnly(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\D+/g, '');
}

/**
 * _formatMoneyDisplay — «60000» → «60 000». Для пустых возвращает ''.
 * Разделитель — NARROW NO-BREAK SPACE (U+202F).
 * Опираемся не на toLocaleString('ru-RU'), а на ручную регулярку —
 * в IE/старых версиях браузеров внутри ифрейма Bitrix Intl-формат
 * иногда выдаёт обычный пробел U+0020, что ломает повторный парсинг.
 */
export function _formatMoneyDisplay(v) {
  const d = _digitsOnly(v);
  if (!d) return '';
  // Подставляем U+202F перед каждыми 3 цифрами от конца.
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
}

/**
 * attachMoneyMask — навешивает обработчики input на все денежные поля
 * в указанном корне (или во всём документе, если root не указан).
 * Поля определяются по атрибуту data-money="1".
 *
 * При вводе:
 *   1. Берём сырое значение из input.value (может содержать буквы/знаки).
 *   2. Чистим через _digitsOnly() и сохраняем в data-raw — именно
 *      это значение потом читает collectFormData() (см. form-submit.js).
 *   3. Рисуем форматированное значение в input.value и восстанавливаем
 *      положение курсора по числу цифр слева (чтобы при вводе в
 *      середине числа курсор не «улетал» в конец).
 *
 * Безопасно вызывать повторно: признак __moneyMaskBound в dataset
 * защищает от двойного listener при повторном рендере блока.
 */
export function attachMoneyMask(root) {
  const scope = root || document;
  const fields = scope.querySelectorAll('input[data-money="1"]');
  fields.forEach(function (el) {
    if (el.dataset.__moneyMaskBound === '1') return;
    el.dataset.__moneyMaskBound = '1';

    function onInput() {
      // Позиция курсора «в цифрах» — сколько цифр стоит слева от курсора до
      // перерисовки. Считаем раз и восстанавливаем после форматирования.
      const selStart = el.selectionStart || 0;
      const digitsBeforeCursor = (el.value.slice(0, selStart).match(/\d/g) || []).length;

      const raw = _digitsOnly(el.value);
      el.dataset.raw = raw;
      el.value = _formatMoneyDisplay(raw);

      // Восстановление курсора: идём по новой строке, считаем цифры,
      // как только досчитали до digitsBeforeCursor — перемещаем курсор.
      let pos = el.value.length;
      let cnt = 0;
      for (let i = 0; i < el.value.length; i++) {
        if (/\d/.test(el.value[i])) {
          cnt++;
          if (cnt === digitsBeforeCursor) { pos = i + 1; break; }
        }
      }
      // Для input.focus()-события на selectionStart может быть null —
      // setSelectionRange вызываем внутри try, чтобы в IE не было ошибки.
      try { el.setSelectionRange(pos, pos); } catch (_) { /* noop */ }
    }

    el.addEventListener('input', onInput);
    // На blur ещё раз прогоняем (пользователь мог вставить через Ctrl+V).
    el.addEventListener('blur',  onInput);
  });
}

/**
 * fieldText — генерирует HTML для однострочного текстового поля (<input type="text">).
 *
 * @param {string} id       — HTML-атрибут id и name у <input>. По нему collectFormData() найдёт поле.
 * @param {string} label    — Текст метки над полем (что заполняет менеджер).
 * @param {string} value    — Текущее значение (берётся из данных лида при инициализации).
 * @param {object} opts     — Дополнительные опции:
 *   opts.colSpan  {bool}   — Если true, поле растягивается на 2 колонки сетки (занимает всю строку).
 *   opts.readonly {bool}   — Если true, поле только для чтения (нельзя редактировать, например ФИО).
 *   opts.placeholder {str} — Подсказка внутри пустого поля (светло-серый текст).
 *   opts.hint     {str}    — Дополнительная пояснительная подпись под полем (мелкий серый текст).
 */
export function fieldText(id, label, value, opts) {
  // Если opts не передан вовсе — используем пустой объект, чтобы не было ошибок при opts.colSpan и т.д.
  opts = opts || {};

  // Если нужно растянуть поле на всю ширину (2 колонки) — добавляем класс col-span-2,
  // иначе поле занимает стандартную 1 колонку.
  const span = opts.colSpan ? 'col-span-2' : '';

  // Возвращаем HTML-строку с меткой и полем ввода.
  // escHtml() экранирует значение value и placeholder — защита от XSS и HTML-инъекций.
  return `
    <div class="flex flex-col gap-0.5 ${span}">
      <!-- Метка над полем: text-[16px] — крупнее (было 14px), серый, жирный текст -->
      <label for="${id}" class="block text-[16px] font-medium text-gray-500 leading-tight">${label}</label>

      <!-- Само текстовое поле:
           - bg-gray-50: светло-серый фон
           - border border-gray-300: серая рамка по умолчанию
           - focus:ring-blue-500 focus:border-blue-500: синяя подсветка при фокусе
           - text-base: базовый размер текста (16px) — раньше было text-xs (12px)
           - rounded-md: скруглённые углы
           - px-2 py-1: небольшие внутренние отступы
           - cursor-default: запрещаем курсор редактирования, если поле readonly
           - disabled:opacity-50: при disabled поле полупрозрачное -->
      <input id="${id}" name="${id}" type="text"
             value="${escHtml(value || '')}"
             ${opts.readonly ? 'readonly' : ''}
             ${opts.placeholder ? `placeholder="${escHtml(opts.placeholder)}"` : ''}
             class="bg-gray-50 border border-gray-300 text-gray-900 text-base rounded-md
                    focus:ring-blue-500 focus:border-blue-500 block w-full px-2 py-1
                    ${opts.readonly ? 'cursor-default' : ''}
                    disabled:opacity-50">

      <!-- Подсказка под полем (если передана opts.hint) — мелкий серый текст, 10px -->
      ${opts.hint ? `<p class="text-[10px] text-gray-400 leading-tight">${escHtml(opts.hint)}</p>` : ''}
    </div>`;
}

/**
 * fieldNumber — генерирует HTML для числового поля (<input type="number">).
 * Используется для денежных сумм (долг, платёж, неофициальный доход).
 * type="number" на мобильных устройствах открывает числовую клавиатуру,
 * а также запрещает ввод нечисловых символов.
 *
 * @param {string} id       — HTML-атрибут id и name у <input>.
 * @param {string} label    — Текст метки над полем.
 * @param {number} value    — Текущее числовое значение из лида.
 * @param {object} opts     — Дополнительные опции:
 *   opts.colSpan     {bool}   — Растянуть на 2 колонки.
 *   opts.placeholder {str}    — Подсказка внутри поля (например '0').
 *   opts.min         {number} — Минимально допустимое значение (например 0 — запрет отрицательных сумм).
 *   opts.hint        {str}    — Подпись под полем.
 */
export function fieldNumber(id, label, value, opts) {
  // Если opts не передан — используем пустой объект, чтобы избежать ошибок.
  opts = opts || {};

  // Если нужно растянуть поле на всю строку — добавляем CSS-класс col-span-2.
  const span = opts.colSpan ? 'col-span-2' : '';

  // Возвращаем HTML-строку.
  // String(value || '') — приводим число к строке для escHtml(), т.к. escHtml ждёт строку.
  return `
    <div class="flex flex-col gap-0.5 ${span}">
      <!-- Метка над полем: text-[16px] — крупнее (было 14px) -->
      <label for="${id}" class="block text-[16px] font-medium text-gray-500 leading-tight">${label}</label>

      <!-- Числовое поле. На экране хранит отформатированное значение «60 000»
           (с неразрывными пробелами), сырое число — в data-raw и в collectFormData.
           type="text" + inputmode="numeric" — на мобильных по-прежнему открывается
           цифровая клавиатура. data-money="1" — маркер для attachMoneyMask().
           Атрибут min раньше был при type=number; больше не нужен —
           отрицательные значения отфильтровываются через _digitsOnly() в маске. -->
      <input id="${id}" name="${id}" type="text" inputmode="numeric" data-money="1"
             value="${escHtml(_formatMoneyDisplay(value))}"
             data-raw="${escHtml(_digitsOnly(value))}"
             ${opts.placeholder ? `placeholder="${escHtml(opts.placeholder)}"` : ''}
             class="bg-gray-50 border border-gray-300 text-gray-900 text-base rounded-md
                    focus:ring-blue-500 focus:border-blue-500 block w-full px-2 py-1">

      <!-- Подпись под полем (если задана) -->
      ${opts.hint ? `<p class="text-[10px] text-gray-400 leading-tight">${escHtml(opts.hint)}</p>` : ''}
    </div>`;
}

/**
 * fieldSelect — генерирует HTML для выпадающего списка (<select>).
 * Используется для enumeration-полей: да/нет, семейное положение, дети, уровень дохода и т.д.
 * Первой опцией всегда идёт «—» (пустое значение) — означает «не выбрано».
 *
 * @param {string} id       — HTML-атрибут id и name у <select>.
 * @param {string} label    — Текст метки над полем.
 * @param {string} value    — Текущее выбранное значение из лида (сравнивается с o.value через ===).
 * @param {Array}  options  — Массив объектов {value, label}: варианты выбора.
 *   Пример: [{value:'Y', label:'Да'}, {value:'N', label:'Нет'}]
 * @param {object} opts     — Дополнительные опции:
 *   opts.colSpan {bool} — Растянуть на 2 колонки.
 */
export function fieldSelect(id, label, value, options, opts) {
  // Если opts не передан — используем пустой объект.
  opts = opts || {};

  // Определяем ширину поля: 1 или 2 колонки сетки.
  const span = opts.colSpan ? 'col-span-2' : '';

  // Формируем HTML-строки для каждой опции списка.
  // String(o.value) === String(value || '') — сравниваем строки, даже если value пришло числом.
  // Если значения совпадают — добавляем атрибут selected, чтобы эта опция была выбрана по умолчанию.
  const optHtml = options.map(function(o) {
    const selected = String(o.value) === String(value || '') ? 'selected' : '';
    return `<option value="${escHtml(String(o.value))}" ${selected}>${escHtml(o.label)}</option>`;
  }).join(''); // Объединяем все <option> в одну строку без разделителей.

  // Возвращаем HTML-строку с меткой и выпадающим списком.
  // Первая опция <option value="">—</option> — пустой выбор ("не заполнено").
  return `
    <div class="flex flex-col gap-0.5 ${span}">
      <!-- Метка над полем: text-[16px] -->
      <label for="${id}" class="block text-[16px] font-medium text-gray-500 leading-tight">${label}</label>

      <!-- Выпадающий список. text-base (16px) вместо text-xs (12px) — крупнее -->
      <select id="${id}" name="${id}"
              class="bg-gray-50 border border-gray-300 text-gray-900 text-base rounded-md
                     focus:ring-blue-500 focus:border-blue-500 block w-full px-2 py-1">
        <!-- Пустая опция «—» означает «не выбрано» и идёт всегда первой -->
        <option value="">—</option>
        ${optHtml}
      </select>
    </div>`;
}

/**
 * fieldTextarea — генерирует HTML для многострочного текстового поля (<textarea>).
 * Используется в блоке «Заметки менеджера»: основная боль, возражения, комментарии.
 *
 * @param {string} id       — HTML-атрибут id и name у <textarea>.
 * @param {string} label    — Текст метки над полем.
 * @param {string} value    — Текущее значение (текст) из лида.
 * @param {object} opts     — Дополнительные опции:
 *   opts.colSpan     {bool}   — Растянуть на 2 колонки (по умолчанию 1 — два textarea в ряд).
 *   opts.rows        {number} — Количество видимых строк textarea (по умолчанию 2).
 *   opts.placeholder {str}    — Подсказка внутри пустого поля.
 */
export function fieldTextarea(id, label, value, opts) {
  // Если opts не передан — используем пустой объект.
  opts = opts || {};

  // По умолчанию textarea занимает 1 колонку — два textarea в ряд.
  // Через opts.colSpan: true можно растянуть на 2 кол.
  const span = opts.colSpan ? 'col-span-2' : '';

  // Возвращаем HTML-строку с меткой и многострочным полем.
  // opts.rows || 2: если высота не задана явно — показываем 2 строки.
  // resize-none: запрещаем ручное изменение размера textarea мышью (сохраняем компактность формы).
  // escHtml(value || ''): содержимое textarea тоже экранируем от HTML-тегов.
  return `
    <div class="flex flex-col gap-0.5 ${span}">
      <!-- Метка над полем: text-[16px] -->
      <label for="${id}" class="block text-[16px] font-medium text-gray-500 leading-tight">${label}</label>

      <!-- Многострочное поле. text-base (было text-xs). resize-none — запрещаем ручное растягивание -->
      <textarea id="${id}" name="${id}" rows="${opts.rows || 2}"
                ${opts.placeholder ? `placeholder="${escHtml(opts.placeholder)}"` : ''}
                class="bg-gray-50 border border-gray-300 text-gray-900 text-base rounded-md
                       focus:ring-blue-500 focus:border-blue-500 block w-full px-2 py-1 resize-none">${escHtml(value || '')}</textarea>
    </div>`;
}

/**
 * fieldCheckbox — генерирует HTML для одиночного чек-бокса с меткой справа.
 *
 * Используется в блоке «Признаки нецелевой встречи» для уточняющих
 * флажков (нет созаёмщика по ипотеке, оспариваемые сделки, форсированный
 * учредитель ООО и т. п.). Хранит состояние в DOM в виде стандартного
 * <input type="checkbox">. В collectFormData() значение читается через
 * el.checked и нормализуется к 'Y' / 'N' — единому формату Bitrix24.
 *
 * Реализован строго на Tailwind утилитарных классах + Flowbite-стилях
 * чек-бокса (см. https://flowbite.com/docs/forms/checkbox/). Никакого
 * кастомного CSS, никакого собственного JS внутри разметки.
 *
 * @param {string} id      — HTML-id чек-бокса (используется в collectFormData).
 * @param {string} label   — Текст метки справа от чек-бокса.
 * @param {boolean|string} checked — Начальное состояние (true / 'Y' = установлен).
 * @param {object} opts    — Дополнительные опции:
 *   opts.colSpan {bool} — Растянуть ячейку на 2 колонки сетки (по умолчанию 1).
 *   opts.hint    {str}  — Дополнительное мелкое пояснение под меткой (опционально).
 */
export function fieldCheckbox(id, label, checked, opts) {
  // Если opts не передан — используем пустой объект.
  opts = opts || {};

  // Признак установленности: принимаем true / 'Y' / 1 как «отмечен».
  // Эта же нормализация дублирует поведение _isYes() из target-status.js,
  // чтобы рендер мог принимать значения как из чистого JS, так и из CRM.
  const isOn = (checked === true || checked === 'Y' || checked === 1 || checked === '1');

  // Расширение на 2 колонки grid-сетки контейнера блока — для длинных меток.
  const span = opts.colSpan ? 'col-span-2' : '';

  // Опциональная мелкая пояснительная подпись под меткой (мелкий серый текст).
  // Полностью на Tailwind — никакого inline style, никакого кастомного CSS.
  const hintHtml = opts.hint
    ? `<p class="ms-6 text-[10px] text-gray-400 leading-tight">${escHtml(opts.hint)}</p>`
    : '';

  // Используется Flowbite-шаблон чек-бокса, а не нативный <input type="checkbox">
  // без классов: нативные стили чек-бокса несовместимы между Chrome / Firefox / Safari
  // (размер галочки, цвет рамки, hover-состояние различаются), и привести их к
  // единому виду без подключения собственного CSS почти невозможно. Tailwind +
  // Flowbite даёт одинаковый рендер во всех браузерах без отдельного CSS-файла,
  // поэтому форма выглядит предсказуемо у всех менеджеров вне зависимости от
  // версии и платформы. ms-2 (margin-inline-start) — корректно работает с RTL.
  return `\n    <div class="flex flex-col gap-0.5 ${span}">` +
         '\n      <div class="flex items-center">' +
         `\n        <input id="${id}" name="${id}" type="checkbox"${ 
           isOn ? ' checked' : '' 
         }\n               class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-2 focus:ring-blue-500">` +
         `\n        <label for="${id}" class="ms-2 text-base text-gray-700 leading-tight">${label}</label>` +
         '\n      </div>' +
         `\n      ${hintHtml 
         }\n    </div>`;
}

/**
 * fieldCity — генерирует HTML для поля ввода города клиента.
 *
 * Это специальное поле с расширенными возможностями:
 *   1. Обязательное (required) — без города нельзя сохранить анкету.
 *      Обязательность отмечена красной звёздочкой (*) рядом с меткой.
 *   2. Связано с часовым поясом (TZ): при выборе города из справочника
 *      calendar.js автоматически устанавливает часовой пояс для расписания.
 *      Это показывает подпись «→ TZ» рядом с меткой.
 *   3. Имеет автодополнение через <datalist>: список 900+ городов России
 *      берётся из глобального объекта CITIES_TZ (файл cities.js).
 *   4. Показывает два разных предупреждения:
 *      - Красная ошибка «Укажите город клиента» — если поле пустое при сохранении.
 *      - Жёлтое предупреждение «Город не найден в справочнике» — если город
 *        введён вручную и его нет в CITIES_TZ (TZ не определится автоматически).
 *
 * (Исправление баг #7: датасписок генерируется из CITIES_TZ, а не из захардкоженного списка.)
 *
 * @param {string} id    — HTML-атрибут id и name у <input>.
 * @param {string} label — Текст метки над полем.
 * @param {string} value — Текущее значение города из лида.
 */
export function fieldCity(id, label, value) {
  // Баг 7 fix: генерируем datalist из CITIES_TZ (cities.js) — полный список городов России.
  // Если файл cities.js не загружен (CITIES_TZ не определён) — используем пустой объект,
  // чтобы не было ошибки ReferenceError.
  const citySource = (typeof CITIES_TZ !== 'undefined') ? CITIES_TZ : {};

  // Формируем <option> для каждого города из справочника.
  // В <datalist> достаточно указать только value — браузер предложит подходящие варианты при вводе.
  const opts = Object.keys(citySource).map(function(c) {
    return `<option value="${escHtml(c)}">`;
  }).join('');

  // Возвращаем HTML-строку поля.
  // autocomplete="off" — отключаем автозаполнение браузера, чтобы не мешало нашему datalist.
  // required — браузерная валидация (дополнительно мы проверяем в validateForm).
  // id="${id}-error" — блок с сообщением об ошибке (скрыт по умолчанию, показывается через showCityError).
  // id="${id}-tz-warn" — блок с предупреждением о неизвестном городе (скрыт по умолчанию).
  return `
    <div class="flex flex-col gap-0.5">
      <label for="${id}" class="block text-[16px] font-medium text-gray-500 leading-tight">
        ${label}
        <!-- Красная звёздочка — визуальный маркер обязательного поля -->
        <span class="text-red-500 ml-0.5" title="Обязательное поле">*</span>
        <!-- Синяя подпись → TZ — напоминает, что город влияет на часовой пояс расписания -->
        <span class="text-blue-400 font-normal ml-1" title="Часовой пояс">→ TZ</span>
      </label>

      <!-- Поле ввода города с автодополнением из datalist.
           list="city-list" привязывает поле к <datalist id="city-list"> ниже. -->
      <input id="${id}" name="${id}" type="text" list="city-list"
             value="${escHtml(value || '')}"
             placeholder="Город..."
             autocomplete="off"
             required
             class="bg-gray-50 border border-gray-300 text-gray-900 text-base rounded-md
                    focus:ring-blue-500 focus:border-blue-500 block w-full px-2 py-1">

      <!-- Список городов для автодополнения. Браузер фильтрует подходящие варианты по вводу. -->
      <datalist id="city-list">${opts}</datalist>

      <!-- Сообщение об ошибке: показывается при попытке сохранить форму с пустым городом.
           По умолчанию скрыто (hidden). Управляется функциями showCityError/clearCityError. -->
      <p id="${id}-error" class="hidden text-[10px] text-red-500">Укажите город клиента</p>

      <!-- Предупреждение: показывается если введённый город не найден в справочнике CITIES_TZ.
           Это не блокирует сохранение, но предупреждает менеджера, что TZ не определится автоматически. -->
      <p id="${id}-tz-warn" class="hidden text-[10px] text-amber-500">Город не найден в справочнике</p>
    </div>`;
}

/**
 * escHtml — экранирует специальные HTML-символы в строке.
 *
 * ЗАЧЕМ НУЖНА:
 *   Данные лида (ФИО, город, комментарии) приходят из Bitrix24 в виде произвольного текста.
 *   Если вставить их напрямую в innerHTML без экранирования — злоумышленник или
 *   некорректные данные могут «сломать» HTML-разметку или выполнить JavaScript-код
 *   (XSS-атака, Cross-Site Scripting).
 *
 * КАК РАБОТАЕТ:
 *   Заменяет 4 опасных символа на их HTML-сущности:
 *     &  →  &amp;   (без этого браузер воспринимает & как начало HTML-сущности)
 *     "  →  &quot;  (без этого кавычка может закрыть атрибут value="...")
 *     <  →  &lt;    (без этого браузер воспринимает < как начало тега)
 *     >  →  &gt;    (без этого браузер воспринимает > как конец тега)
 *
 * @param {any} s — Входное значение (будет приведено к строке через String()).
 * @returns {string} — Безопасная HTML-строка, готовая для вставки в атрибуты и текстовые узлы.
 */
export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')   // & первым обязательно: иначе следующие замены сами создадут &amp;, &lt;, &quot; — и при повторном проходе они превратятся в &amp;amp;, &amp;lt; и т.д., текст в полях задвоится
    .replace(/"/g, '&quot;')  // экранирование " нужно потому, что результат подставляется в атрибуты вида value="..." — без замены кавычка в данных порвала бы атрибут и оставшийся текст оказался бы частью разметки
    .replace(/</g, '&lt;')    // без замены < браузер начал бы парсить остаток данных как открытие тега, и часть формы исчезла бы из DOM
    .replace(/>/g, '&gt;');   // > заменяем парно с < — асимметричная замена иногда приводит к тому, что валидаторы HTML ругаются на оставшиеся одиночные >
}

// ─── Опции для enumeration-полей ────────────────────────────────────────────
//
// Каждый массив OPTS_* содержит варианты для конкретного выпадающего списка.
// Структура элемента: { value: 'ключ_для_crm', label: 'Текст для менеджера' }
// value — то, что сохраняется в поле CRM; label — то, что видит менеджер в форме.

/**
 * OPTS_YES_NO — универсальный список «Да / Нет».
 * Используется сразу для нескольких полей-флажков:
 *   KC_JOINT_PROPERTY (совместное имущество с супругом/ой),
 *   KC_CRIMINAL       (наличие судимостей),
 *   KC_OOO            (является ли клиент учредителем ООО),
 *   KC_IP             (зарегистрирован ли как ИП),
 *   KC_COLLATERAL     (есть ли залоговое имущество по кредитам),
 *   KC_FSSP           (есть ли исполнительные производства в ФССП),
 *   KC_PROPERTY       (есть ли имущество в собственности),
 *   KC_DEALS          (были ли сделки по отчуждению имущества за последние 3 года).
 *
 * value 'Y'/'N' — стандарт Bitrix24 для булевых полей.
 */
export const OPTS_YES_NO = [
  { value: 'Y', label: 'Да' },  // Y = Yes — стандарт Bitrix24
  { value: 'N', label: 'Нет' }  // N = No
];

/**
 * OPTS_SALARY_CARD — варианты для поля «Зарплатная карта» (KC_SALARY_CARD).
 * Важно для оценки рисков: если зарплата поступает в Сбербанк, а там же есть кредит,
 * банк может автоматически списывать долг из зарплаты.
 */
export const OPTS_SALARY_CARD = [
  { value: 'sber',  label: 'Сбербанк' },   // Зарплата приходит в Сбербанк (повышенный риск списания)
  { value: 'other', label: 'Другой банк' }, // Зарплата в любом другом банке
  { value: 'none',  label: 'Нет' }          // Нет зарплатной карты (наличные, самозанятый и т.п.)
];

/**
 * OPTS_MARITAL — варианты для поля «Семейное положение» (KC_MARITAL_STATUS).
 * Влияет на правовую сторону дела: наличие супруга/и означает совместно нажитое имущество,
 * которое может быть включено в конкурсную массу при банкротстве.
 */
export const OPTS_MARITAL = [
  { value: 'single',   label: 'Не в браке' },     // Одинок/одинока, официально не состоял/а в браке
  { value: 'married',  label: 'В браке' },          // Официально женат/замужем
  { value: 'divorced', label: 'Разведён/а' },       // Официально разведён/а
  { value: 'widow',    label: 'Вдовец/вдова' }      // Супруг/а умер/умерла
];

/**
 * OPTS_CHILDREN — варианты для поля «Дети» (KC_CHILDREN).
 * Количество детей влияет на расчёт прожиточного минимума,
 * который суд вычитает из доходов при банкротстве.
 * '3+' объединяет три и более детей в одну категорию.
 */
export const OPTS_CHILDREN = [
  { value: '0', label: 'Нет' },   // Детей нет
  { value: '1', label: '1' },      // Один ребёнок
  { value: '2', label: '2' },      // Двое детей
  { value: '3', label: '3+' }      // Трое и более детей
];

