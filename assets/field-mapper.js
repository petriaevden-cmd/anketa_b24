/**
 * field-mapper.js — маппинг значений анкеты в формат UF полей Битрикс24.
 *
 * Все 22 поля анкеты сопоставлены с реальными UF портала по системным именам
 * (см. /home/user/workspace/specs/field-mapper-spec.md).
 *
 * Формат значений в Bitrix:
 *  - money:    "сумма|RUB"
 *  - boolean:  1 / 0
 *  - enum:     числовой ID варианта
 *  - string/datetime: as-is
 */

// === Маппинг enum-значений ===

const MARITAL_MAP = {
  married:  4752,
  single:   4753,
  divorced: 4754,
  widow:    5219
};

const CHILDREN_MAP = {
  '0': 4757,
  '1': 4758,
  '2': 5224,
  '3': 5225
};

const YN_ENUM = {
  jointProperty: { Y: 4755, N: 4756 },
  criminal:      { Y: 4759, N: 4760 },
  ooo:           { Y: 4761, N: 4762 },
  ip:            { Y: 4763, N: 4764 },
  fssp:          { Y: 4746, N: 4747 }
};

const SALARY_CARD_MAP = {
  sber:  'Сбербанк',
  other: 'Другой банк',
  none:  'Нет'
};

// TZ менеджеров (IANA) по enum-ID варианта поля UF_CRM_1747120414.
// Соответствие enum → IANA-зона; bookingManagerEnumId задан в mp-config.js.
// Сейчас bookedTimeMP в booking.js считается через целочисленный UTC-офсет
// (mp.utc, см. fmtIsoWithOffset), а не через IANA, поэтому таблица оставлена
// как справочный артефакт на случай миграции на Intl.DateTimeFormat.
export const MANAGER_TZ = {
  2099: 'Europe/Moscow',         // МП 1 — Москва
  2100: 'Europe/Moscow',         // МП 2 — Санкт-Петербург
  2101: 'Europe/Yekaterinburg',  // МП 3 — Екатеринбург, UTC+5
  2102: 'Asia/Novosibirsk',      // МП 4 — Новосибирск, UTC+7
  2103: 'Europe/Moscow',         // МП 5 — Казань, UTC+3
  5086: 'Europe/Moscow',         // МП 6 — Краснодар
  5092: 'Europe/Moscow',         // МП 7 — Нижний Новгород
  5101: 'Europe/Moscow'          // МП 8 — Ростов-на-Дону
};

// === Хелперы ===

function toMoney(v) {
  const n = String(v ?? '').replace(/\D/g, '');
  return n ? `${n}|RUB` : '';
}

function ynToBool(v) {
  return v === 'Y' ? 1 : 0;
}

function toInt(v) {
  const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// === Главная функция ===

export function mapFormToBitrixFields(form) {
  const out = {};

  // Группа 1. Персональные данные
  if (form.fio)            out.UF_CRM_1764765025374 = form.fio;
  if (form.clientCity)     out.UF_CRM_1521214081    = form.clientCity;
  if (form.workplace)      out.UF_CRM_1764767699419 = form.workplace;
  if (MARITAL_MAP[form.maritalStatus] !== undefined)
    out.UF_CRM_1764767738244 = MARITAL_MAP[form.maritalStatus];
  if (CHILDREN_MAP[form.children] !== undefined)
    out.UF_CRM_1764767804861 = CHILDREN_MAP[form.children];
  if (form.jointProperty)
    out.UF_CRM_1764767768332 = YN_ENUM.jointProperty[form.jointProperty];
  if (form.criminal)
    out.UF_CRM_1764767860124 = YN_ENUM.criminal[form.criminal];
  if (form.ooo)
    out.UF_CRM_1764767873758 = YN_ENUM.ooo[form.ooo];
  if (form.ip)
    out.UF_CRM_1764767897075 = YN_ENUM.ip[form.ip];

  // Группа 2. Финансовые данные
  if (form.debtTotal)        out.UF_CRM_1764765055684 = toMoney(form.debtTotal);
  if (SALARY_CARD_MAP[form.salaryCard])
    out.UF_CRM_1764767677345 = SALARY_CARD_MAP[form.salaryCard];
  if (form.monthlyPayment)   out.UF_MONTHLY_PAYMENT   = toMoney(form.monthlyPayment);
  if (form.officialIncome)   out.UF_OFFICIAL_INCOME   = toMoney(form.officialIncome);
  if (form.unofficialIncome) out.UF_UNOFFICIAL_INCOME = toMoney(form.unofficialIncome);

  // Группа 3. Кредитная история
  if (form.creditors)        out.UF_CRM_1764765826044 = form.creditors;
  if (form.overdue)          out.UF_CRM_1764767202050 = form.overdue;
  if (form.fssp)             out.UF_CRM_1764767243083 = YN_ENUM.fssp[form.fssp];
  if (form.deposit !== undefined && form.deposit !== '')
    out.UF_DEPOSIT     = ynToBool(form.deposit);
  if (form.possessions !== undefined && form.possessions !== '')
    out.UF_POSSESSIONS = ynToBool(form.possessions);
  if (form.deals !== undefined && form.deals !== '')
    out.UF_DEALS       = ynToBool(form.deals);

  // Группа 4. Заметки менеджера
  if (form.kmExclusion)      out.UF_CRM_1764767905632 = form.kmExclusion;
  if (form.mainPain)         out.UF_CRM_1764767920445 = form.mainPain;
  if (form.objections)       out.UF_CRM_1764767933689 = form.objections;
  if (form.extraComment)     out.UF_CRM_1764767947408 = form.extraComment;

  // Группа 5. Запись на встречу
  // UF_CALENDAR_EVENTS не пишем: этим занимается БП «Назначить встречу»
  // (TEMPLATE_ID=40) — поле имеет тип Integer, БП кладёт туда числовой ID
  // созданного события календаря.
  // bookedManagerCalId теперь содержит уже готовый enum-ID варианта поля
  // UF_CRM_1747120414 (его проставляет booking.js из mp.enumId), поэтому
  // никакого дополнительного маппинга calId → enum здесь не требуется.
  if (form.bookedManagerCalId) {
    const enumId = toInt(form.bookedManagerCalId);
    if (enumId !== null) out.UF_CRM_1747120414 = enumId;
  }
  if (form.bookedTimeMP)        out.UF_CRM_1598875875    = form.bookedTimeMP;
  if (form.bookedTimeClient)    out.UF_CRM_1750343005859 = form.bookedTimeClient;

  // Группа 6. Целевой/Нецелевой КЦ.
  // Значение берётся из window.__targetStatus.id, рассчитанного evaluateTargetStatus().
  // 289 = Целевой, 290 = Нецелевой, 291 = Не определено.
  // Записывается при каждом сохранении анкеты, а не только при бронировании через БП.
  if (form.targetStatusId != null) {
    const tsId = parseInt(form.targetStatusId, 10);
    if (tsId === 289 || tsId === 290 || tsId === 291) {
      out.UF_CRM_1649136704 = tsId;
    }
  }

  return out;
}
