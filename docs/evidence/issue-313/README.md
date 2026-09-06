# Верхняя шапка Sachkov Inside — #313

Реализация выбранной шапки A и словесного логотипа C из #311. Снимки сделаны 2026-09-06
на исходниках `c184261`: Storybook и реальные маршруты используют одни production-компоненты.

| Поверхность | Desktop | Mobile |
|---|---|---|
| Storybook с демонстрационным содержимым | [1440 px](storybook-1440.png) | [320 px](storybook-320.png) |
| Реальная Главная с локальными данными Nest/PostgreSQL | [1440 px](live-1440.png) | [390 px](live-390.png), [320 px](live-320.png) |

Дополнительно: [открытое меню](live-mobile-menu.png),
[Reader после прокрутки](live-mobile-reader-scrolled.png). Отсутствующее изображение в тестовом
Reader — состояние локальных данных; оно не подменено фикстурой. Вход у гостя виден без открытия
меню. Возврат в Reader остаётся под шапкой.

## Проверка

- `PLAYWRIGHT_PORT=3313 pnpm check` — passed: documentation, generated API drift, lint, types,
  architecture guardrails, tooling/backend/web/Storybook tests, 41 route checks (3 неприменимых
  для конкретного viewport skipped), production build, standalone config и Storybook build.
- 20 focused Storybook checks для шапки, состояния авторизации и Reader — passed. Проверка Reader
  сравнивает координаты после прокрутки при 100% и 200% текста.
- Пять дополнительных browser captures — passed: отсутствие горизонтального overflow,
  доступность полного названия и входа, axe WCAG 2/2.1 A/AA без serious/critical findings внутри
  public shell. Служебный Agentation исключён из области automated audit и доступен для review.
- В реальных маршрутах проверены POST-формы входа, выхода и восстановления сессии через
  перехват запросов, профиль, capability-gated Редактор, Telegram onboarding, клавиатура,
  возврат фокуса и семантическое выбранное состояние.
- Standards и Spec review от `5447fc6` — без открытых замечаний. Перекрытие возврата Reader
  исправлено и повторно проверено по обеим осям.

## Воспроизведение просмотра

Запустить обычные repository-local `pnpm storybook` и `pnpm dev:web` с доступным локальным backend.
В Storybook открыть `Patterns/Mobile-first Platform/Navigation`, истории `DesktopHeader`,
`MobileHeader`, `Authenticated`, `MobileAccount`, `Unavailable`. Для реального приложения открыть
`/`, `/library` и `/materials/kak-ustroen-inside-platform`; мобильную прокрутку проверить на ширине
320–390 px. Точные локальные адреса текущего просмотра приведены в PR.

## Граница доказательства

Внешний identity provider с реальной сессией и полный локальный full-stack smoke не запускались;
auth endpoints, права и data ownership не менялись. Публикация не выполнялась. Выбор прототипа
зафиксирован владельцем; финальный production visual GO и отдельный merge GO остаются открытыми.
