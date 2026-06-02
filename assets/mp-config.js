// =============================================================================
// assets/mp-config.js — конфигурация МП (v3, server-loaded)
// =============================================================================
//
// Что изменилось по сравнению с v2:
//
//   1. Список МП БОЛЬШЕ НЕ ХАРДКОДИТСЯ. Раньше здесь жил объект MP_CONFIG с
//      8 менеджерами, чьи имена, города, часы работы и Bitrix-userId были
//      зашиты в JS. Это давало три проблемы:
//        а) calId формировался как `MP${bitrixUserId}Vstrechi` — но реальные
//           типы календарей на портале crm.yurclick.com называются
//           MP1Vstrechi..MP11Vstrechi (где число — порядковый номер МП, не
//           userId). То есть приложение генерировало несуществующие calId.
//        б) Список МП в коде, ТЗ (docs/tz.md) и реальных календарях Bitrix24
//           разъезжался — кто чей, было непонятно.
//        в) Часы работы и таймзону приходилось менять в коде, хотя ТЗ требует
//           брать их «из Bitrix24, не хардкодить».
//
//   2. Теперь источник истины — calendar.section.get для type=MP[N]Vstrechi
//      (см. loadMpCalendarsFromPortal в slots.js). Здесь же остаются только
//      ДВЕ вещи, которые из портала через REST не вытащить:
//
//        • MP_BOOKING_ENUM_MAP — соответствие номера МП и enum-варианта поля
//          UF_CRM_1747120414 «Менеджер встречи». БП «Назначить встречу» (id=40)
//          принимает именно числовой enumId, и без него встреча не запишется.
//          Значения скопированы из старого MP_CONFIG: 1→2099, 2→2100, ..., 8→5101.
//          Для МП 9, 10, 11 enumId пока неизвестен (календари в Bitrix24 уже
//          существуют, но enum-варианты под них не созданы) — оставлено null,
//          slots.js предупредит в консоли при попытке записи.
//
//        • MP_WORK_DEFAULTS — параметры рабочего времени, рабочих дней и TZ.
//          В calendar.section.get этих полей физически НЕТ (мы проверили
//          discovery-запросом в discovery-tooling.md). Поэтому до момента,
//          когда в Bitrix24 заведут отдельное хранилище графиков (через UF
//          календарной секции или пользовательский справочник), значения
//          живут здесь. Это компромисс между «всё из портала» и «работает».
//
//   3. helper-функции (getActiveMPs, isMPWorkday, getMPDaySlots) удалены —
//      их потребители (slots.js) теперь работают с MP_CALENDARS, который
//      собирается на старте приложения из реального ответа Bitrix24.
//
// ВАЖНО: этот файл не подключается через ES-модули. Он грузится обычным
// <script src> в index.php, поэтому объявленные здесь константы становятся
// глобальными window.MP_BOOKING_ENUM_MAP и window.MP_WORK_DEFAULTS.
// =============================================================================

/**
 * MP_BOOKING_ENUM_MAP — соответствие номера МП → enumId для БП «Назначить встречу».
 *
 * Источник значений: enum-варианты поля UF_CRM_1747120414 на портале yurclick.
 * При создании нового МП (например, МП12) администратор Bitrix24 должен:
 *   1. Создать календарь type=MP12Vstrechi (это делается интерфейсом Bitrix).
 *   2. Создать enum-вариант поля UF_CRM_1747120414 с подписью «МП12».
 *   3. Скопировать ID нового enum-варианта и добавить сюда: 12: 1234.
 *
 * null означает «enum-вариант не создан». slots.js увидит null и пометит
 * соответствующего МП как booking-disabled (записать к нему через анкету
 * нельзя, но в расписании он будет виден как «занят весь день»).
 */
const MP_BOOKING_ENUM_MAP = {
  1: 2099,
  2: 2100,
  3: 2101,
  4: 2102,
  5: 2103,
  6: 5086,
  7: 5092,
  8: 5101,
  9:  null,  // календарь MP9Vstrechi (#82) есть, enum-варианта пока нет
  10: null,  // календарь MP10Vstrechi (#83) есть, enum-варианта пока нет
  11: null,  // календарь MP11Vstrechi (#84) есть, enum-варианта пока нет
};

/**
 * MP_WORK_DEFAULTS — рабочий график МП.
 *
 * Ключ — номер МП (1..11). Поля:
 *   workStart  — HH:MM, начало рабочего дня в локальном времени МП.
 *   workEnd    — HH:MM, конец рабочего дня (исключительно: 19:00 → последний
 *                слот 18:00–19:00).
 *   workDays   — массив дней недели по getDay() (0=вс, 1=пн, ..., 6=сб).
 *   utcOffset  — целое число часов смещения от UTC (для Самары = 4, МСК = 3).
 *   slotMinutes — длительность одного слота. По ТЗ — только 60 минут.
 *
 * Если в Bitrix24 будет заведено централизованное хранилище графиков
 * (например, UF-поля у секции календаря через calendar.section.update +
 * custom-fields, либо отдельная сущность в smart-process), эти значения
 * нужно убрать отсюда и подтягивать в slots.js рядом с calendar.section.get.
 */
const MP_WORK_DEFAULTS = {
  1:  { workStart: '10:00', workEnd: '19:00', workDays: [1,2,3,4,5],     utcOffset: 4, slotMinutes: 60 },
  2:  { workStart: '09:00', workEnd: '17:00', workDays: [1,2,3,4,5],     utcOffset: 4, slotMinutes: 60 },
  3:  { workStart: '10:00', workEnd: '19:00', workDays: [1,2,3,4,5],     utcOffset: 4, slotMinutes: 60 },
  4:  { workStart: '10:00', workEnd: '19:00', workDays: [1,2,3,4,5],     utcOffset: 4, slotMinutes: 60 },
  5:  { workStart: '11:00', workEnd: '20:00', workDays: [1,2,3,4,5,6],   utcOffset: 2, slotMinutes: 60 },
  6:  { workStart: '10:00', workEnd: '19:00', workDays: [0,1,2,3,4,5,6], utcOffset: 3, slotMinutes: 60 },
  7:  { workStart: '10:00', workEnd: '19:00', workDays: [1,2,3,4,5],     utcOffset: 3, slotMinutes: 60 },
  8:  { workStart: '10:00', workEnd: '19:00', workDays: [1,2,3,4,5],     utcOffset: 4, slotMinutes: 60 },
  9:  { workStart: '10:00', workEnd: '19:00', workDays: [1,2,3,4,5],     utcOffset: 3, slotMinutes: 60 },
  10: { workStart: '10:00', workEnd: '19:00', workDays: [1,2,3,4,5],     utcOffset: 3, slotMinutes: 60 },
  11: { workStart: '10:00', workEnd: '19:00', workDays: [1,2,3,4,5],     utcOffset: 3, slotMinutes: 60 },
};

/**
 * MP_NUMBERS — диапазон существующих в системе номеров МП.
 *
 * Используется в slots.js: на старте приложение делает Promise.all из N
 * параллельных calendar.section.get запросов с type=MP[N]Vstrechi
 * и оставляет в MP_CALENDARS только те, что реально вернулись.
 *
 * На CRM: 11 МП. На DEV: 5 МП.
 */
const MP_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/**
 * MP_DEV_SECTION_IDS — жёсткие ID секций календарей для DEV-портала (dev.yurclick.com).
 *
 * На DEV типы секций MP[N]Vstrechi совпадают с CRM, но сами ID секций другие.
 * Приложение сначала делает обычный calendar.section.get по type=MP[N]Vstrechi;
 * если секция вернулась — берёт её ID как обычно.
 * Если же ответ пуст (секция на DEV не нашлась по типу) —
 * slots.js подставляет ID из этой таблицы, чтобы calendar.event.get
 * всё равно получил правильную секцию.
 *
 * Ключ — номер МП (1..5). Значение — реальный ID секции на dev.yurclick.com.
 * Источник: calendar.section.get по type=MP[N]Vstrechi на dev.yurclick.com (проверено через вебхук).
 * На DEV те же типы MP[N]Vstrechi, просто другие ID секций по сравнению с CRM.
 */
const MP_DEV_SECTION_IDS = {
  1: 20,   // MP1Vstrechi на dev.yurclick.com
  2: 15,   // MP2Vstrechi
  3: 16,   // MP3Vstrechi
  4: 18,   // MP4Vstrechi
  5: 19    // MP5Vstrechi
};

// Для node-окружения (lint, unit-тесты в будущем).
if (typeof module !== 'undefined') module.exports = {
  MP_BOOKING_ENUM_MAP, MP_WORK_DEFAULTS, MP_NUMBERS, MP_DEV_SECTION_IDS
};
