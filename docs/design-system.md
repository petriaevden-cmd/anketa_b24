# Дизайн-система — Анкета КЦ

> **Стек:** Tailwind CSS 4 + Flowbite 2  
> Самописные CSS-файлы (`tokens.css`, `style.css`) не используются.

---

## Принципы

- Весь UI строится через **utility-классы Tailwind**. Нет отдельных CSS-классов для компонентов `form-field`, `card-section` и т.п.
- Готовые интерактивные элементы берутся из **Flowbite** (вкладки, карточки, кнопки, формы, алерты).
- Кастомные стили допустимы только для Bitrix24 iframe-особенностей (например, `overflow: hidden` на `body`).
- Новый дизайн не проектируется с нуля при каждой итерации — компоненты развиваются внутри одного стека.

---

## Подключение

```html
<!-- Tailwind CSS 4 CDN -->
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          primary: { DEFAULT: '#2563eb', dark: '#1d4ed8' },
        },
      },
    },
  };
</script>

<!-- Flowbite CSS -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/flowbite/2.3.0/flowbite.min.css" />

<!-- Flowbite JS (в конце body) -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/flowbite/2.3.0/flowbite.min.js"></script>
```

---

## Палитра

Цветовые токены определяются через `tailwind.config` в `<script>` внутри `index.php`.

| Токен | Значение | Применение |
|---|---|---|
| `primary` | `#2563eb` | Основной акцент (CTA, прогресс-бар, активные элементы) |
| `primary.dark` | `#1d4ed8` | hover-состояние |
| `gray-50` | Tailwind | Фон панелей |
| `gray-100` | Tailwind | Фон `<body>` |
| `gray-200` | Tailwind | Границы, разделители |
| `gray-800` | Tailwind | Основной текст |
| `red-50 / red-700` | Tailwind | Ошибки |
| `green-50 / green-700` | Tailwind | Успех |
| `blue-50 / blue-600` | Tailwind | Информационные элементы |

---

## Типографика

| Роль | Классы Tailwind |
|---|---|
| Шапка / название приложения | `text-sm font-bold text-gray-900` |
| Название блока формы | `text-xs font-semibold text-gray-700` |
| Метка поля | `text-xs font-medium text-gray-500` |
| Основной текст | `text-xs text-gray-800` |
| Второстепенный текст | `text-xs text-gray-400` |
| Подсказка под полем | `text-xs text-gray-400` |

---

## Компоненты

### Кнопка primary

```html
<button class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white
               text-xs font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-300 transition-colors">
  Сохранить
</button>
```

### Кнопка secondary

```html
<button class="inline-flex items-center px-4 py-2 rounded-lg border border-gray-200
               bg-white text-xs text-gray-600 hover:bg-gray-50 transition-colors">
  Сбросить
</button>
```

### Поле формы (Input)

```html
<div class="flex flex-col gap-1">
  <label class="block text-xs font-medium text-gray-500">Метка</label>
  <input type="text"
         class="bg-gray-50 border border-gray-300 text-gray-900 text-xs rounded-lg
                focus:ring-blue-500 focus:border-blue-500 block w-full p-2">
</div>
```

### Select

```html
<select class="bg-gray-50 border border-gray-300 text-gray-900 text-xs rounded-lg
               focus:ring-blue-500 focus:border-blue-500 block w-full p-2">
  <option>— выбрать —</option>
</select>
```

### Textarea

```html
<textarea rows="2"
          class="bg-gray-50 border border-gray-300 text-gray-900 text-xs rounded-lg
                 focus:ring-blue-500 focus:border-blue-500 block w-full p-2 resize-none">
</textarea>
```

### Блок формы (Card с заголовком)

```html
<div class="bg-white border border-gray-200 rounded-lg shadow-sm">
  <!-- Заголовок -->
  <div class="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
    <span class="flex items-center gap-2 text-xs font-semibold text-gray-700">
      <span class="w-5 h-5 rounded bg-blue-50 flex items-center justify-center text-blue-500">₽</span>
      1. Финансовые данные
    </span>
  </div>
  <!-- Тело: сетка полей -->
  <div class="px-3 py-3 grid grid-cols-2 gap-2 text-xs">
    <!-- поля -->
  </div>
</div>
```

### Alert — ошибка

```html
<div class="flex items-center p-3 text-sm text-red-800 rounded-lg bg-red-50 border border-red-200" role="alert">
  <svg class="shrink-0 inline w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/>
  </svg>
  <span>Текст ошибки</span>
</div>
```

### Alert — успех

```html
<div class="flex items-center p-3 text-sm text-green-800 rounded-lg bg-green-50 border border-green-200" role="alert">
  <svg class="shrink-0 w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
  </svg>
  <span>Анкета сохранена.</span>
</div>
```

### Spinner (загрузка)

```html
<div role="status">
  <svg class="w-4 h-4 text-gray-200 animate-spin fill-blue-500" viewBox="0 0 100 101" fill="none">
    <path d="M100 50.6C100 78.2 77.6 100.6 50 100.6S0 78.2 0 50.6 22.4.6 50 .6s50 22.4 50 50z" fill="currentColor"/>
    <path d="M93.97 39.04a4.28 4.28 0 0 1 2.69 5.4 50.04 50.04 0 0 1-12.44 21.54 4.28 4.28 0 0 1-6.05-6.05 41.48 41.48 0 0 0 10.31-17.85 4.28 4.28 0 0 1 5.49-3.04z" fill="currentFill"/>
  </svg>
</div>
```

### Слот расписания (свободный)

```html
<button type="button"
  class="px-2 py-1 text-xs rounded-md bg-blue-50 text-blue-700 border border-blue-100
         hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-colors whitespace-nowrap">
  вт, 12 апр 09:00
</button>
```

### Вкладки правой панели (Flowbite Tabs)

```html
<ul class="flex text-xs font-medium" role="tablist">
  <li role="presentation">
    <button class="inline-flex items-center gap-1.5 px-3 py-2 rounded-t-lg
                   border-b-2 border-blue-600 text-blue-600 bg-gray-50"
            data-tabs-target="#tab-schedule" type="button" role="tab">
      Расписание
    </button>
  </li>
</ul>
```

---

## Шаблонные CSS-классы (Bitrix24 iframe)

Допускаемые инлайн-стили в `<style>` внутри `index.php` — только для iframe-особенностей:

```css
/* Минимальный reset для Bitrix24 iframe */
html, body { margin: 0; padding: 0; overflow: hidden; }
#app { height: 100vh; overflow: hidden; }
.panel-scroll { overflow-y: auto; }

/* Кастомный скроллбар */
.panel-scroll::-webkit-scrollbar { width: 4px; }
.panel-scroll::-webkit-scrollbar-track { background: transparent; }
.panel-scroll::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }
```

---

## Что нельзя

- Подключать `tokens.css` или `style.css`.
- Создавать новые отдельные CSS-файлы для компонентов.
- Использовать `!important` для переопределения Tailwind.
- Проектировать новый визуальный язык с нуля при каждой итерации.
