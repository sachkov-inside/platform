# Восстановление прерванной загрузки видео — #390

Дата: 2026-09-11. Фиксированная база Platform: `b41ff41e6cbe160f5a2cb3f5ef50e0f08a12be50`.

Снимки сделаны в собранном Storybook этой ветки, размеры совпадают с проектами Playwright:
desktop 1440, mobile 390. Storybook получает только состояние представления; upload, Kinescope API
и права доступа остаются за production adapters. Это доказательство состава и текста интерфейса,
а не реальной загрузки в Kinescope.

| Файл | Что показывает |
|---|---|
| `recovered-checking-desktop.png` | Подхваченная загрузка: объяснение и ожидание ответа Kinescope |
| `recovered-checking-mobile.png` | То же на 390 px |
| `recovered-incomplete-desktop.png` | Файл дошёл не полностью: названа причина, «Проверить» остаётся для соседней вкладки |
| `recovered-incomplete-mobile.png` | То же на 390 px |
| `recovered-failed-desktop.png` | Kinescope не смог обработать файл: «Проверить» убрана, повтор проверки бесполезен |
| `recovered-failed-mobile.png` | То же на 390 px |

Горизонтального переполнения нет ни на одной ширине: снимок делается только после проверки
`scrollWidth === clientWidth`.

## Что проверено и чем

| Утверждение | Исполняемое доказательство |
|---|---|
| Незавершённая загрузка материала находится и переживает закрытие вкладки | `apps/backend/test/integration/videos.test.ts`: «offers an unsettled upload of a Material…» на реальном PostgreSQL |
| Установленный исход и выбранное видео не предлагаются заново | тот же тест: после `reconcile` до `ready` и при выбранном видео ответ пустой |
| External Attachment не выдаётся за загрузку Platform | `videos.test.ts`: «never offers an External Attachment as a recoverable upload» |
| Материал показывает незавершённую загрузку и перестаёт после сохранения | `apps/backend/test/integration/material-authoring.test.ts`: «reports an upload the Material never saved…» |
| «Убрать» у готового видео не отменяется восстановлением | тот же тест: после detach `unselectedVideoUpload` остаётся пустым |
| Поле доходит до черновика редактора | `apps/web/test/module/material-authoring.test.ts` |
| Решения восстановления: усыновление, ворота опроса, исход сверки, снятие | `apps/web/test/module/material-video-recovery.test.ts`, 12 проверок |
| Текст и состав интерфейса в трёх состояниях | три истории Storybook, прогоняются в Chromium |

## Не доказано этим протоколом

Реальная загрузка файла в Kinescope, воспроизведение и приёмка на production остаются
в [#355](https://github.com/sachkov-inside/platform/issues/355) и
[#184](https://github.com/sachkov-inside/platform/issues/184). Полный авторский видеопроцесс —
[#444](https://github.com/sachkov-inside/platform/issues/444).

Браузерный набор `pnpm test:e2e` локально не запустился: на машине закончились файловые
дескрипторы из-за процессов других сессий (`EMFILE` в watcher Next). Набор проверяет CI.
