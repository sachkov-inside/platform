# #967 — production-раздел «Сдачи»

Принятый прототип A сохранён в `prototype/967-learning-submissions`,
`24148f0430c6d8ef44e66b2ca0f908c581293f43`. Production-ветка создана от свежего
`origin/main` (`e00efc1c9ee53462462e6eb6eff734a2d17fb827`); прототип не объединялся с ней.

Снимки показывают production-owned модуль `apps/web/src/_pages/task-submissions`,
общий для Storybook и `/authoring/submissions`. Последнее изменение production Source:
`4b4e33bbe2d0b438f29472a14ee49a7cc79792b6`. Последующие commits до передачи добавляют
инструмент снимков и evidence; production Source остаётся тем же. Commit прогона Storybook
записан в [storybook-checks.json](storybook-checks.json). Точный передаваемый HEAD — в PR #1344.

Финальный **production visual GO владельца ещё требуется**. Принятие прототипа не заменяет его.

## Снимки для приёмки

| Состояние | Storybook 390 | Storybook 1440 | Live route 390 | Live route 1440 |
| --- | --- | --- | --- | --- |
| Очередь и полный отчёт | [PNG](storybook-report-is-text-390.png) | [PNG](storybook-report-is-text-1440.png) | [PNG](live-ready-mobile-chromium.png) | [PNG](live-ready-desktop-chromium.png) |
| Историческая версия | [PNG](storybook-submissions-390.png) | [PNG](storybook-submissions-1440.png) | [PNG](live-historical-version-mobile-chromium.png) | [PNG](live-historical-version-desktop-chromium.png) |
| Сохранённый отзыв | [PNG](storybook-feedback-saves-390.png) | [PNG](storybook-feedback-saves-1440.png) | [PNG](live-saved-feedback-mobile-chromium.png) | [PNG](live-saved-feedback-desktop-chromium.png) |
| Ошибка сохранения и черновик | [PNG](storybook-feedback-save-fails-390.png) | [PNG](storybook-feedback-save-fails-1440.png) | [PNG](live-save-error-mobile-chromium.png) | [PNG](live-save-error-desktop-chromium.png) |
| Loading | [PNG](storybook-loading-390.png) | [PNG](storybook-loading-1440.png) | [PNG](live-loading-mobile-chromium.png) | [PNG](live-loading-desktop-chromium.png) |
| Empty | [PNG](storybook-empty-390.png) | [PNG](storybook-empty-1440.png) | [PNG](live-empty-mobile-chromium.png) | [PNG](live-empty-desktop-chromium.png) |
| Empty filter | [PNG](storybook-empty-filter-390.png) | [PNG](storybook-empty-filter-1440.png) | — | — |
| Access denied | [PNG](storybook-forbidden-390.png) | [PNG](storybook-forbidden-1440.png) | [PNG](live-denied-mobile-chromium.png) | [PNG](live-denied-desktop-chromium.png) |
| Нужен вход | [PNG](storybook-unauthorized-390.png) | [PNG](storybook-unauthorized-1440.png) | [PNG](live-expired-mobile-chromium.png) | [PNG](live-expired-desktop-chromium.png) |
| Ошибка загрузки | [PNG](storybook-unavailable-390.png) | [PNG](storybook-unavailable-1440.png) | [PNG](live-load-error-mobile-chromium.png) | [PNG](live-load-error-desktop-chromium.png) |
| Сессия истекла во время сохранения | [PNG](storybook-expired-session-390.png) | [PNG](storybook-expired-session-1440.png) | — | — |

## Что доказывают прогоны

- Storybook: 17 interaction/a11y-сценариев, включая сохранность разных черновиков,
  текст без исполняемой разметки, mutation, ошибки, зависимые фильтры, ссылки пагинации,
  `LoadsInPlace` на 390/1440 и свежий серверный отзыв после запоздалого ответа.
- Модульные проверки: 18 тестов loader/presentation/guide/reconciliation. Проверены
  закрытые права/сессия/зависимость, чужой chapter/task scope, некорректный cursor/ответ,
  критерии исторической версии, полный evidence и reportText, подтверждение перед submit,
  повторные сохранения и запоздалые ответы, удаление отзыва, dirty и pending drafts.
- Live route: 14 сценариев на **Next production build**, штатном server loader и BFF.
  Проверены фильтры, пагинация и selection, сохранение при смене выбранной сдачи,
  повторное сохранение, сохранность черновиков, загрузка и ошибки. Данные и сессии
  синтетические; HTTP fixture выбирает исходы, а не проверяет права реального backend.
- Все 22 Storybook-снимка и 18 live-снимков: `scrollWidth === clientWidth`, Axe по `main`
  без нарушений. Десктопная очередь находится слева от отчёта, мобильная — над ним.
  Полная страница снята штатным `screenshotWholePage`, включая прокручиваемую область.

Права автора/ученика, чужие сдачи, access loss/restore, scope, version/hash и идемпотентность
принадлежат существующим реальным PostgreSQL/HTTP/MCP suites:
[product-tasks](../../../apps/backend/test/integration/product-tasks.test.ts),
[author review](../../../apps/backend/test/integration/product-task-submission-review.test.ts),
[HTTP](../../../apps/backend/test/integration/product-tasks-http.test.ts),
[learner scopes](../../../apps/backend/test/integration/scoped-learner-access-mcp.test.ts).
В Cloud их локальный старт остановлен сетевой политикой: закреплённый образ
`public.ecr.aws/docker/library/postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15`
возвращает `Forbidden` при pull. Результат этих suites проверяется в current-head CI;
локальный запуск не считается прошедшим. Отдельный full-stack browser stand локально не запускался.

Независимые Standards/Spec review выполнялись от исходного `main`. Исправлены stale RSC
после повторного сохранения, закрепление свежего server baseline, loading footprint,
разделение ошибок practice/task и имя client boundary. Регрессия provider до исправления
получала «Серверный отзыв 2» вместо «Серверный отзыв 3»; после исправления проходит.

## Воспроизведение

Node `26.10.0`, pnpm `11.27.1`, Playwright `1.63.0`. В Cloud браузеры взяты из официального
`mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27`.
Версии зависимостей и lockfile не менялись.

```bash
pnpm docs:check
pnpm check
pnpm build:storybook
UPDATE_EVIDENCE=issue-967 bash scripts/heavy-check.sh \
  pnpm --filter @inside/web exec node test/evidence/capture-task-submissions.mjs
PRODUCTION_WEB_SKIP_BUILD=1 CAPTURE_SUBMISSIONS_EVIDENCE=1 UPDATE_EVIDENCE=issue-967 \
  pnpm --filter @inside/web test:navigation task-submissions.spec.ts
```

Последняя команда использует production-сборку из `pnpm check`. Для interactive preview:
`pnpm storybook` и
[Submissions](http://localhost:6006/?path=/story/pages-authoring-task-submissions--submissions).
Это адрес локального Storybook, а не опубликованный Cloud-сайт; доступные снимки находятся выше.

## Оставшаяся приёмка

1. Владелец даёт visual GO production-интерфейсу по точному HEAD PR.
2. Оркестратор подтверждает фактическую публикацию privacy v4: URL, версия, дата/digest и
   deployed SHA. Одобренный пакет PR #995 включён как Source; включение в Git не подтверждает
   публикацию. `PRODUCT_TASK_SUBMISSIONS_ENABLED` в production остаётся выключенным до этого.
3. В отдельном этапе проверяются настоящая production OAuth-авторизация Codex и оставшиеся
   native clients, полный контекст, подтверждение отчёта, submit/retry и свои сдачи с отзывом.
   Синтетический цикл не объявляется production-проверкой; Claude403 не восстанавливается.
4. Оркестратор выполняет merge/deploy. Контент наполняет владелец; количество глав и календарь
   не служат техническими условиями запуска. Ручной редактор и платный помощник не входят в объём.

Черновики отзывов хранятся в памяти layout по submissionId. Они переживают выбор, filters,
pagination и ошибки сохранения; полная перезагрузка документа заканчивает сеанс редактирования.
Для истёкшей сессии форма предлагает войти в другой вкладке и повторить сохранение.
