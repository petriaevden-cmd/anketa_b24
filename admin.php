<?php
/**
 * admin.php — Админ-панель анкеты (apcheit.ru/yurclick/anketa-kc/admin.php)
 *
 * Standalone-страница, НЕ встраивается в iframe Битрикса.
 * Доступ — по паролю (см. ADMIN_PASSWORD в admin-config.php).
 *
 * Маршрут:
 *   1. GET без сессии → показать форму логина.
 *   2. POST с паролем → авторизовать и редирект.
 *   3. GET с валидной сессией → показать SPA-интерфейс.
 *
 * UI сделан на Tailwind CSS (CDN) — как в index.php/install.php.
 * Вся клиентская логика — в assets/admin.js.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/admin-config.php';

session_name(ADMIN_SESSION_NAME);
session_set_cookie_params([
    'lifetime' => ADMIN_SESSION_LIFETIME,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

$isAuthed = !empty($_SESSION['admin_authed']) && $_SESSION['admin_authed'] === true;
$loginError = '';

// Обработка POST = логин или логаут.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['action']) && $_POST['action'] === 'logout') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
        header('Location: ' . $_SERVER['PHP_SELF']);
        exit;
    }

    if (isset($_POST['password']) && !$isAuthed) {
        if (hash_equals((string)ADMIN_PASSWORD, (string)$_POST['password'])) {
            session_regenerate_id(true);
            $_SESSION['admin_authed']  = true;
            $_SESSION['admin_user']    = ADMIN_USERNAME;
            $_SESSION['admin_last_seen'] = time();
            header('Location: ' . $_SERVER['PHP_SELF']);
            exit;
        } else {
            $loginError = 'Неверный пароль';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Анкета — Админ-панель</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/flowbite/2.3.0/flowbite.min.css" />
    <style>
        html, body { margin: 0; padding: 0; height: 100%; background: #f9fafb; }
        .scroll-thin::-webkit-scrollbar { width: 6px; height: 6px; }
        .scroll-thin::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        .scroll-thin::-webkit-scrollbar-track { background: transparent; }
        [data-field-row].is-dirty { background: #fef3c7; }
        [data-field-row].is-dirty label { color: #92400e; }
    </style>
</head>
<body class="text-gray-800 text-sm antialiased">

<?php if (!$isAuthed): ?>
    <!-- ─── Форма входа ───────────────────────────────────────────────── -->
    <div class="min-h-screen flex items-center justify-center px-4">
        <form method="POST" class="w-full max-w-sm bg-white shadow-sm rounded-xl border border-gray-200 p-6">
            <div class="flex items-center gap-2 mb-4">
                <div class="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold">⚙</div>
                <div>
                    <h1 class="text-base font-semibold text-gray-900">Анкета — Админ-панель</h1>
                    <p class="text-xs text-gray-500">Вход по паролю</p>
                </div>
            </div>

            <label for="password" class="block text-xs font-medium text-gray-700 mb-1">Пароль</label>
            <input type="password" id="password" name="password" autofocus required
                   class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
                   placeholder="••••••">

            <?php if ($loginError): ?>
                <p class="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <?= htmlspecialchars($loginError, ENT_QUOTES) ?>
                </p>
            <?php endif; ?>

            <button type="submit"
                    class="mt-4 w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                Войти
            </button>

            <p class="mt-4 text-[11px] text-gray-400 text-center">
                Доступ только для админов. Все действия логируются.
            </p>
        </form>
    </div>

<?php else: ?>
    <!-- ─── Основной интерфейс ───────────────────────────────────────── -->
    <div class="h-screen flex flex-col">

        <!-- Шапка -->
        <header class="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3 shrink-0">
            <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-md bg-blue-600 text-white flex items-center justify-center text-xs font-bold">⚙</div>
                <span class="font-semibold text-gray-900">Анкета · Админ</span>
            </div>
            <div class="w-px h-5 bg-gray-200"></div>
            <span class="text-xs text-gray-500">apcheit.ru/yurclick/anketa-kc</span>

            <div class="ml-auto flex items-center gap-2">
                <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    <?= htmlspecialchars(ADMIN_USERNAME, ENT_QUOTES) ?>
                </span>
                <form method="POST" class="inline">
                    <input type="hidden" name="action" value="logout">
                    <button type="submit"
                            class="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded-md hover:bg-gray-50">
                        Выйти
                    </button>
                </form>
            </div>
        </header>

        <!-- Тело -->
        <div class="flex-1 flex overflow-hidden">

            <!-- Левая колонка: поиск + список лидов -->
            <aside class="w-[340px] shrink-0 bg-white border-r border-gray-200 flex flex-col">
                <div class="p-3 border-b border-gray-100">
                    <form id="search-form" class="flex gap-2" autocomplete="off">
                        <input id="search-q" type="text"
                               placeholder="ID, имя, фамилия, телефон…"
                               class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500">
                        <button type="submit"
                                class="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                            Найти
                        </button>
                    </form>
                    <p id="search-mode" class="mt-2 text-[11px] text-gray-400">Показаны последние изменённые лиды</p>
                </div>
                <div id="lead-list" class="flex-1 overflow-y-auto scroll-thin"></div>
            </aside>

            <!-- Правая колонка: редактор + история -->
            <main class="flex-1 flex flex-col bg-gray-50 overflow-hidden">

                <!-- Заглушка, пока лид не выбран -->
                <div id="empty-state" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
                    Выберите лид слева, чтобы отредактировать его анкету
                </div>

                <!-- Контейнер редактора (скрыт пока пусто) -->
                <div id="editor" class="hidden flex-1 flex flex-col overflow-hidden">

                    <!-- Шапка лида -->
                    <div id="lead-header" class="bg-white border-b border-gray-200 px-5 py-3 shrink-0"></div>

                    <!-- Кнопки действий -->
                    <div class="bg-white border-b border-gray-100 px-5 py-2 shrink-0 flex items-center gap-2">
                        <button id="btn-save" type="button"
                                class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                            </svg>
                            Сохранить изменения
                        </button>
                        <button id="btn-reload" type="button"
                                class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50">
                            Перечитать
                        </button>
                        <button id="btn-revert" type="button"
                                class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-gray-50">
                            Отменить правки
                        </button>
                        <span id="dirty-badge" class="hidden ml-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-100 text-amber-800 text-xs">
                            <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                            Есть несохранённые изменения
                        </span>
                        <span id="save-status" class="ml-auto text-xs text-gray-400"></span>
                    </div>

                    <!-- Поля лида (прокручиваемая зона) -->
                    <div id="fields-area" class="flex-1 overflow-y-auto scroll-thin"></div>

                    <!-- История изменений -->
                    <div class="bg-white border-t border-gray-200 shrink-0 max-h-[40%] flex flex-col">
                        <div class="px-5 py-2 border-b border-gray-100 flex items-center gap-2 shrink-0">
                            <svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                            <span class="text-xs font-semibold text-gray-700">История изменений</span>
                            <span id="log-count" class="text-xs text-gray-400"></span>
                        </div>
                        <div id="log-list" class="overflow-y-auto scroll-thin px-5 py-2"></div>
                    </div>

                </div>
            </main>
        </div>
    </div>

    <!-- Утилитарные шаблоны (используются admin.js) -->
    <template id="tpl-field-input">
        <div data-field-row class="grid grid-cols-3 gap-3 items-start py-2">
            <div class="col-span-1">
                <label class="block text-xs font-medium text-gray-700"></label>
                <p class="text-[11px] text-gray-400 mt-0.5"></p>
            </div>
            <div class="col-span-2">
                <input type="text" data-input
                       class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500">
            </div>
        </div>
    </template>

    <template id="tpl-field-money">
        <div data-field-row class="grid grid-cols-3 gap-3 items-start py-2">
            <div class="col-span-1">
                <label class="block text-xs font-medium text-gray-700"></label>
                <p class="text-[11px] text-gray-400 mt-0.5"></p>
            </div>
            <div class="col-span-2 relative">
                <input type="text" inputmode="numeric" data-input
                       class="w-full px-3 py-1.5 pr-9 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500">
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">₽</span>
            </div>
        </div>
    </template>

    <template id="tpl-field-boolean">
        <div data-field-row class="grid grid-cols-3 gap-3 items-start py-2">
            <div class="col-span-1">
                <label class="block text-xs font-medium text-gray-700"></label>
                <p class="text-[11px] text-gray-400 mt-0.5"></p>
            </div>
            <div class="col-span-2 flex items-center gap-4 pt-1.5">
                <label class="inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" data-input value="Y" class="text-blue-600 focus:ring-blue-500">
                    <span>Да</span>
                </label>
                <label class="inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" data-input value="N" class="text-blue-600 focus:ring-blue-500">
                    <span>Нет</span>
                </label>
                <button type="button" data-clear class="text-[11px] text-gray-400 hover:text-gray-600 underline">очистить</button>
            </div>
        </div>
    </template>

    <template id="tpl-field-enum">
        <div data-field-row class="grid grid-cols-3 gap-3 items-start py-2">
            <div class="col-span-1">
                <label class="block text-xs font-medium text-gray-700"></label>
                <p class="text-[11px] text-gray-400 mt-0.5"></p>
            </div>
            <div class="col-span-2">
                <select data-input
                        class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white focus:ring-blue-500 focus:border-blue-500">
                </select>
            </div>
        </div>
    </template>

    <template id="tpl-field-datetime">
        <div data-field-row class="grid grid-cols-3 gap-3 items-start py-2">
            <div class="col-span-1">
                <label class="block text-xs font-medium text-gray-700"></label>
                <p class="text-[11px] text-gray-400 mt-0.5"></p>
            </div>
            <div class="col-span-2">
                <input type="datetime-local" data-input
                       class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500">
            </div>
        </div>
    </template>

    <template id="tpl-field-readonly">
        <div data-field-row class="grid grid-cols-3 gap-3 items-start py-2">
            <div class="col-span-1">
                <label class="block text-xs font-medium text-gray-500"></label>
                <p class="text-[11px] text-gray-400 mt-0.5"></p>
            </div>
            <div class="col-span-2">
                <div data-display class="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-md text-sm text-gray-700 font-mono"></div>
            </div>
        </div>
    </template>

    <template id="tpl-field-textarea">
        <div data-field-row class="grid grid-cols-3 gap-3 items-start py-2">
            <div class="col-span-1">
                <label class="block text-xs font-medium text-gray-700"></label>
                <p class="text-[11px] text-gray-400 mt-0.5"></p>
            </div>
            <div class="col-span-2">
                <textarea data-input rows="3"
                          class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"></textarea>
            </div>
        </div>
    </template>

    <script src="assets/admin.js"></script>

<?php endif; ?>

</body>
</html>
