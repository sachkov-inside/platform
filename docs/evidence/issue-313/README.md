# Desktop-шапка и мобильная навигация — #313

Верхняя шапка A со словесным логотипом C **Sachkov Inside** используется только на desktop.
По уточнению владельца mobile сохраняет прежнюю нижнюю навигацию «Главная / База знаний /
Профиль», без верхней шапки и кнопки меню. Вход и выход доступны через Профиль, поиск — через
Базу знаний. Снимки обновлены 2026-09-06 на исходниках `a5ba311`; Storybook и реальные маршруты
используют одни production-компоненты.

| Поверхность | Desktop | Mobile |
|---|---|---|
| Storybook с демонстрационным содержимым | [1440 px](storybook-1440.png) | [320 px](storybook-320.png) |
| Реальная Главная с локальными данными Nest/PostgreSQL | [1440 px](live-1440.png) | [390 px](live-390.png), [320 px](live-320.png) |

Дополнительно: [вход через Профиль](live-mobile-profile.png),
[Reader после прокрутки](live-mobile-reader-scrolled.png). Изображение тестового Reader отсутствует
в локальных данных; оно не подменено фикстурой. Локальный возврат закреплён сверху, нижняя
навигация остаётся видимой.

## Проверка

- 16 focused Storybook checks для шапки, нижней навигации и Reader — passed: выбранный раздел,
  три ссылки, targets ≥44 px, отсутствие мобильной шапки, фиксированная позиция dock при
  прокрутке, возврат Reader при 100% и 200% текста.
- 39 route checks — passed, 5 viewport-specific checks skipped: вход с desktop-шапки или через
  mobile Profile отправляет POST; desktop account/recovery меню; capability-gated Редактор;
  Telegram onboarding; keyboard/focus; нижняя панель не перекрывает уведомление.
- Пять browser captures — passed: Storybook и live route, отсутствие горизонтального overflow,
  desktop-шапка и mobile dock, axe WCAG 2/2.1 A/AA без serious/critical findings внутри public
  shell. Служебный Agentation исключён из automated audit и доступен для review.
- Полный repository gate: `PLAYWRIGHT_PORT=3313 pnpm check`. Результат текущего head и обе оси
  review записываются в PR #314; прежний успешный запуск не считается проверкой новой версии.

## Воспроизведение просмотра

Запустить обычные repository-local `pnpm storybook` и `pnpm dev:web` с доступным локальным backend.
В Storybook открыть `Patterns/Mobile-first Platform/Navigation`: `DesktopHeader`,
`MobileBottomNavigation`, `Authenticated`, `MobileAccount`, `Unavailable`. В приложении открыть
`/`, `/library`, `/account` и `/materials/kak-ustroen-inside-platform`; проверить ширины 320–390 px
и desktop. Точные локальные адреса текущего просмотра приведены в PR.

## Граница доказательства

Внешний identity provider с реальной сессией и полный локальный full-stack smoke не запускались;
auth endpoints, права и data ownership не менялись. Публикация не выполнялась. Финальный
production visual GO и отдельный merge GO остаются открытыми.
