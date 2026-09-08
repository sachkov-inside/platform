# #448: руководства

Фиксированная база Platform: `5ebafbc937f3a11bcab32fddaf0eabd20200396f`.
Session: `codex-448-guides-20260908`; start receipt подтверждён 08.09.2026.

## Уточнение среды от владельца, 08.09.2026

Все изменения выполнены локально; код подготовлен в PR #459. Production не изменялся.
Production пока не рабочая среда продукта; находившиеся там тестовые записи не представляют
ценные пользовательские данные. Обновление production состоится одним отдельным шагом
после готовности локальной версии. Проверки после production deploy не требуются для #448.

## Исторический снимок тестовой среды

Production снимок 08.09.2026 получен через PostgreSQL в read-only repeatable-read транзакции.
Один Guide/Series `Test`: UUID `6d0d2b78-18aa-4aa0-a0f8-77326a7b1cb6`, slug `test`, version 1,
не в архиве, без собственной обложки. Единственное размещение:
Material `fe5ea57f-fbfd-41ae-b962-bd56b287f353`, ordinal 1, stepGroup null.
В базе два Material: один draft и один published; одна ручная отметка и одна video resume запись.
Digest текущих Materials: `0621967a8ce43ed2cdca3626734d2c1d` (MD5 сериализованных строк по ID,
контроль совпадения снимка, не криптографическое доказательство). Содержимое и Account IDs
в этот отчёт не выгружались. Публичный каталог независимо подтвердил один опубликованный Material
и тот же Series UUID. Данные не изменялись.

В Inside Content отдельно проверены 48 Materials и три комплекта:
`ci-and-reproducible-releases` (25 основных), `working-with-agents` (17 основных и 3 дополнительных),
`application-infrastructure` (5 основных). Metadata перенесены 1:1; SHA-256 всех файлов материалов
совпали до/после операции. Повтор обработал 0 файлов. Production-каталог не содержит эти
редакционные руководства: локальная миграция не означает их публикацию.

## Проверки

- Inside Content: 34 unit tests; metadata check; map и сверка состава/байтов.
- `pnpm test:integration`: 39 файлов, 257 тестов, успешно. PostgreSQL проверяет те же
  записи через canonical и legacy HTTP, одинаковый состав/прогресс, stale version и права.
- Полный `pnpm check`: успешно на Node 24.19.0. Включает docs/API contracts, lint,
  typecheck, guardrails, 153 tooling tests, Go checks, 512 backend tests,
  555 Web tests (1 предусмотренный skip), E2E 52 passed / 14 предусмотренных
  viewport skips, production build, standalone config и Storybook build.
  Команда: `WATCHPACK_POLLING=true PLAYWRIGHT_PORT=3448 pnpm check`.
  Polling применён из-за macOS `EMFILE` в файловом watcher на общей машине;
  исходный прогон остановлен, итоговый полный прогон завершён с кодом 0.
- Локальный browser smoke: Chromium, 390×844 и 1440×1024. Старый и новый адреса дают
  одинаковые ordinal и размеры строк; переход в Material сохраняет контекст и возврат,
  прямой адрес Material не подставляет контекст. Библиотека и редактор доступны; кнопка
  создания и содержимое редактора не выходят за экран. Axe: 0 нарушений на Guide.
- Storybook использует production-компонент Guide с 24 Materials, прогрессом 8/24,
  видео resume и второй страницей состава. Снимки мобильного и desktop состояний осмотрены.

## UI evidence

| Поверхность | Mobile | Desktop |
|---|---|---|
| Руководство, локальный full-stack | [PNG](live-guide-mobile.png) | [PNG](live-guide-desktop.png) |
| Material по прямой ссылке | [PNG](live-direct-material-mobile.png) | [PNG](live-direct-material-desktop.png) |
| Библиотека | [PNG](live-library-mobile.png) | [PNG](live-library-desktop.png) |
| Редактор руководств | [PNG](live-authoring-mobile.png) | [PNG](live-authoring-desktop.png) |
| Guide, Storybook `Series journey / Mobile` | [PNG](storybook-guide-mobile.png) | [PNG](storybook-guide-desktop.png) |

[Измерения browser smoke](browser-results.json) относятся к isolated PostgreSQL fixtures.
На mobile сохранена нижняя навигация; она закреплена относительно viewport, поэтому при
full-page capture оказывается внутри длинного изображения. Next dev indicator виден только
в локальном full-stack. Это не production-снимки и не подтверждение владельцем на его устройстве.

Переименование потребовало сократить видимый текст кнопки редактора до «Создать»;
её доступное имя осталось «Создать руководство». Header переносит элементы при недостатке места.
Геометрия reader/Guide и расчёт прогресса не менялись. Story `GuidesMobile` проверяет границы кнопки.

## Граница доказательств

Production deploy и миграционные записи не выполнялись. Исторический snapshot выше не означает
работающий продукт и не требует последующей production-сверки в этой задаче. Локальные
PostgreSQL и browser проверки используют изолированные данные и внешние provider fixtures.
По одобренному владельцем порядку #459 мержится первым; затем редактор и закреп #427
адаптируются к руководствам. #448 остаётся открытой до проверки совместного результата.
Production-домен из #422 относится к будущей отдельной поставке.
