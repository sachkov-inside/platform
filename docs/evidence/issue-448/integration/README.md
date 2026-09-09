# Совместная проверка руководств, редактора и закрепа — #448 / #425

База интеграции: `0df9aea1` (main после #459 и #462). Продолжение существующего PR #427;
первый проход миграции и его inventory сохранены в [отчёте #448](../README.md).
Прежний worktree #425 и основной checkout не изменялись. Для продолжения получены start receipts:
#425 — session `codex-20260908-home-pin-425`, #448 — `codex-448-guides-20260909`.

## Результат

Отдельная страница руководства сохраняет название, описание, обложку и состав. Закреп доступен
в списке и редакторе и задаёт один общий первый блок Home для гостя и участника. Старый адрес
`/authoring/playlists/:id` открывает тот же редактор; новые ссылки ведут в `/authoring/guides/:id`.
Material не принимается как объект закрепа. Названия `seriesId`, `pinnedSeries` и физические
таблицы остаются совместимыми; Prisma использует Guide и PublishedMaterialGuideMembership.

Архивирование теперь ждёт все несохранённые правки редактора, включая состав и незавершённую
загрузку обложки. При ошибке сохранения архивирование не выполняется. Эта проверка использует
существующий общий механизм pending edits и не вводит второй владелец состояния.

## Проверки

Все итоговые команды выполнены на Node 24.19.0, pnpm 11.22.0.

- `WATCHPACK_POLLING=true PLAYWRIGHT_PORT=3449 pnpm check` — успешно: docs/API drift,
  lint, types, guardrails, tooling/Go, 512 backend tests, 577 Web/Storybook tests (1 предусмотренный
  skip), E2E 52 passed / 14 viewport skips, production build, standalone и Storybook build.
- `pnpm --filter @inside/backend test:integration --maxWorkers=4` — 42 файла, 274 теста успешно.
  Включены неизменный prefix/checksum миграций, canonical/legacy Guide, чтение/прогресс,
  singleton закрепа, запрет Material UUID, права, CAS-конкуренция, archive/empty fallback,
  сохранение настройки после изменения публикации и снятие закрепа.
- `pnpm smoke:fullstack` с `FULLSTACK_TEST_GREP='author Home pin|author edits series metadata|trusted author reorders a PostgreSQL series|guest Home|Guide|guide compatibility'` —
  10 сценариев успешно на desktop/mobile, реальные BFF/API/PostgreSQL и MCP. У smoke обновлён
  ожидаемый discovery-контракт двумя ранее добавленными `guide_*` инструментами.
- После review-исправления повторены `pnpm typecheck`, `pnpm --filter @inside/web test`,
  `pnpm build:storybook` и весь указанный full-stack smoke — успешно.
- Storybook Docs и production-owned страницы проверены на 390×844 и 1440×1024.
  Browser smoke проверяет отсутствие overflow при text 200%, axe, состояние loading/error/retry
  без сдвига списка, сохранение/замену/снятие закрепа и отказ участнику без author permission.

Первый DB-прогон на автоматически выбранном Node 25 имел два timeout больших fixtures;
итоговый прогон на закреплённом Node с четырьмя workers завершился без ошибок.

## Review closure

Standards review исходной интеграции: без замечаний. Spec review нашёл гонку «добавить материал →
сразу архивировать»: metadata flush не дожидался отдельного composition autosave. Регрессионный
full-stack тест с удерживаемым ответом сохранения воспроизвёл её на desktop и mobile, затем прошёл
на обоих после общего flush. Дополнительно исправлены устаревшее ожидание бейджа доступа в
journey smoke и подсказка уже сохранённого закрепа. Итоговые review/head/CI записаны в PR #427.

## Снимки

| Поверхность | Desktop | Mobile |
| --- | --- | --- |
| Список, Storybook | [PNG](storybook-list-desktop.png) | [PNG](storybook-list-mobile.png) |
| Редактор, Storybook | [PNG](storybook-editor-desktop.png) | [PNG](storybook-editor-mobile.png) |
| Сохранённый закреп в списке, full-stack | [PNG](live-desktop-authoring-pin.png) | [PNG](live-mobile-authoring-pin.png) |
| Редактор по старому адресу, full-stack | [PNG](live-desktop-guide-editor.png) | [PNG](live-mobile-guide-editor.png) |
| Редактор, text 200% | [PNG](live-desktop-guide-editor-text-200.png) | [PNG](live-mobile-guide-editor-text-200.png) |
| Главная с закрепом | [PNG](live-desktop-home-pin.png) | [PNG](live-mobile-home-pin.png) |
| Главная, text 200% | [PNG](live-desktop-home-pin-text-200.png) | [PNG](live-mobile-home-pin-text-200.png) |
| Руководство и продолжение | [PNG](live-guide-desktop.png) | [PNG](live-guide-mobile.png) |

## Inside Content и граница доказательств

Текущая авторская база прочитана без записи. После первоначальной миграции владелец отдельно
одобрил главы и включение внешних сервисов в инфраструктурное руководство; локальный
`docs/guide-migration.md` сохраняет решение, снимки и проверку переноса 48 Materials без потери metadata.
На чтении 09.09.2026 инфраструктурное руководство содержит 7 глав / 30 материалов, руководство
про агентов — 7 / 21 и 3 общих дополнения. Новая карьерная заготовка содержит 7 пустых глав.
Это последующая редакционная работа: она сохранена, не откатывается к первоначальным трём
комплектам и не импортируется в Platform. Поддержка импорта глав относится к #449.
Content commit/push, публикация и production не выполнялись.

Full-stack использует синтетическую identity, demo-контент и тестовый Kinescope. Это доказательство
локальной интеграции, не real-provider acceptance. PostgreSQL/MinIO и процессы full-stack после
проверки остановлены. Общий пользовательский Compose-стенд не изменялся.
Owner visual GO и merge GO остаются отдельными решениями по `WORKFLOW.md`.
