# Новая рабочая админка, #1617

Подготовленная реализация по выбранному варианту A. Окончательная визуальная приёмка владельцем
ещё не проведена. Рабочий интерфейс использует существующие production-компоненты, маршруты и
адаптеры. Storybook подставляет только данные и ответы запросов.

## Просмотр

- **Работающая отдельная админка:** <http://127.0.0.1:4396/authoring/products>.
  Настоящие маршруты и операции, отдельная локальная база, демонстрационные записи и синтетический
  администратор. Можно переходить через меню и пробовать действия. Это не данные рабочего стенда.
- [PR #1622](https://github.com/sachkov-inside/platform/pull/1622). Актуальные проверки и их исходы записываются в PR.

- Новый интерфейс: <http://localhost:6036/?path=/story/pages-authoring-продукты--products-desktop>.
  Остальные страницы находятся в каталоге `Pages/Authoring`.
- Сравнение с выбранным прототипом: <http://localhost:6026/iframe.html?id=prototypes-admin-redesign--workspace&viewMode=story&variant=A>.
- [Задача #1617](https://github.com/sachkov-inside/platform/issues/1617).
- [Исследование библиотек и референсов](../../../research/2026-10-20-admin-ui-foundations.md).
- [Карта операций и их нового размещения](../../../research/2026-10-20-admin-operations.md).

Боковое меню в историях показывает настоящие адреса приложения. Для перехода между историями
используется дерево Storybook. Настоящие переходы проверяются отдельно на live routes.
Прототип остаётся на `prototype/admin-redesign`, commit `35082ef81e9248760c3528bae1bd3bab3d92960f`.

## Визуальные проверки

Исходные 18 снимков на `b176fd7f` показывают девять состояний при 1440 и 390 px. Перед съёмкой шрифты загружены,
прокрутка документа и области `main` возвращена к началу. Это снимки первого экрана, они не
утверждают проверку всех скрытых вкладок или содержимого ниже кадра.

| Экран | Компьютер | Телефон |
| --- | --- | --- |
| Продукты | [1440](products-1440.png) | [390](products-390.png) |
| Программа продукта | [1440](product-editor-1440.png) | [390](product-editor-390.png) |
| Материалы | [1440](materials-1440.png) | [390](materials-390.png) |
| Параметры материала | [1440](material-editor-1440.png) | [390](material-editor-390.png) |
| Темы | [1440](topics-1440.png) | [390](topics-390.png) |
| Люди, фильтр по источнику | [1440](people-1440.png) | [390](people-390.png) |
| Платежи | [1440](payments-1440.png) | [390](payments-390.png) |
| Ожидание набора | [1440](analytics-1440.png) | [390](analytics-390.png) |
| Сдачи | [1440](submissions-1440.png) | [390](submissions-390.png) |

[Измерения](measurements.json): в этих 18 состояниях `scrollWidth === clientWidth`, axe-core с
WCAG A/AA не обнаружил нарушений. Состояния историй могут выполнять свои сценарии; завершение
их отрисовки не считается доказательством прохождения всех Storybook-тестов.

Независимый finish review потребовал убрать пустые синие обложки, сократить мобильные фильтры
платежей и показать состояние, сумму и доступ без горизонтальной прокрутки. Все три исправления
оценены как `resolved`; итог `ship` относится к этой проверке исправлений. Он не заменяет
приёмку владельцем и проверку остальных состояний.

## Ресурсы просмотра

- Новый Storybook: порт 6036, worktree `shrimp`, Orca terminal
  `term_b655a32e-a3ab-4388-9488-a9fcf4e932a9`.
- Прототип: порт 6026, worktree `admin-approved-proof`, Orca terminal
  `term_fcee6a38-517e-4269-a0bc-50ee58bf242e`.
- Оба сервера запущены из `apps/web` через `pnpm exec storybook dev --port <port> --host 0.0.0.0 --no-open`.
  Используется Node 26.10.0. Остановка: Ctrl+C в указанном терминале.
- Общий Compose-стенд с данными принадлежит другой сессии и не изменялся.


## Готовая реализация в Storybook и live routes

После исправлений и объединения с main снята текущая реализация
`6f0397c1a282dac71f21a96159333801cf0cffd4`:

- [Storybook: продукты, 1440](current-storybook/products-1440.png), [390](current-storybook/products-390.png).
- [Storybook: платежи, 1440](current-storybook/payments-1440.png), [390](current-storybook/payments-390.png).
- [Измерения текущих историй](current-storybook/measurements.json): 4 состояния, нет переполнения и axe WCAG A/AA нарушений.
- [Live: продукты, 1440](live/products-1440.png), [390](live/products-390.png).
- [Live: редактор материала, 1440](live/material-editor-1440.png), [390](live/material-editor-390.png).
- [Live: редактор продукта, 1440](live/product-editor-1440.png), [390](live/product-editor-390.png).
- [Live: платежи, 1440](live/payments-1440.png), [390](live/payments-390.png).
- [Live: люди, 1440](live/people-1440.png), [390](live/people-390.png).
- [Live: материалы, 1440](live/materials-1440.png), [390](live/materials-390.png).
- [Live: темы, 1440](live/topics-1440.png), [390](live/topics-390.png).
- [Live: воронка, 1440](live/analytics-1440.png), [390](live/analytics-390.png).
- [Live: сдачи, 1440](live/submissions-1440.png), [390](live/submissions-390.png).

[Live measurements](live/measurements.json): 18 состояний, нет горизонтального переполнения,
axe WCAG A/AA и best-practice без нарушений. Снимки показывают основные страницы и параметры
существующего материала; они не доказывают все возможные данные и ошибки во всех вкладках.

Для локального просмотра используется штатный `pnpm editor:local` в режиме разработки. На
сессионных маршрутах Next.js пишет development diagnostics об uncached data; авторский layout
явно разрешает блокирующую загрузку через `instant = false` по ADR 0027. Встроенный индикатор Next.js
на снимках относится к этому режиму. Проверки переходов выполняются отдельно на production build.

Общий прогон содержит 921 Storybook test, 173 прошедших browser E2E (15 skipped) и 221 прошедшую
проверку navigation (9 skipped). Дополнительный `pnpm smoke:enrollments` прошёл на desktop/mobile.
Итог расширенного fullstack, final-head CI и текущий source SHA находятся в PR, чтобы запись
проверок не меняла проверяемый код после каждого запуска. Окончательный визуальный GO остаётся
за владельцем.

## Отдельный работающий стенд для владельца

- Worktree: `/Users/dev/orca/workspaces/inside-platform/admin-live-review`, исходный код UI `6f0397c1`.
- Gateway: `127.0.0.1:4396`, PID 77648; API: 4397, PID 78777; Next.js: 4398, PID 78783.
- Orca terminal: `term_34fb0be3-2ba8-42bb-8c3a-45a52e9cbcee`.
- Compose project: `admin1617-preview`, только `postgres` (54396) и `object-storage` (9036, console 9037).
  Это принадлежащие этой задаче данные просмотра. Они сохранены для проверки владельцем.
- Запуск из этого worktree: `PATH=/Users/dev/.local/share/fnm/node-versions/v26.10.0/installation/bin:$PATH pnpm editor:local`.
- Остановка приложения: Ctrl+C в указанном терминале. Остановка инфраструктуры из этого worktree:
  `COMPOSE_PROJECT_NAME=admin1617-preview POSTGRES_HOST_PORT=54396 OBJECT_STORAGE_HOST_PORT=9036 OBJECT_STORAGE_CONSOLE_HOST_PORT=9037 docker compose down`.
  Обычная остановка сохраняет демонстрационные данные. Не применять эту команду к общему `inside-platform`.
- Source Storybook 6036: PID 94692, cwd `shrimp/apps/web`. Прототип 6026: PID 81889,
  cwd `admin-approved-proof/apps/web`. Оба просмотра сохранены для сравнения.
