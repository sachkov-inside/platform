# #781: production-подтверждение продажи подписки всем

Доказательства подготовлены 2026-10-11 на source
`245dad3b5d6b563c046b1312be55cfa05fb8c851`, после принятия макета и текста proof #1348.
Компоненты находятся в `features/billing-admin/ui`; Storybook и production используют одну
реализацию. Эти файлы фиксируют preparation/capture stage. Финальные unfiltered
`pnpm smoke:fullstack`, полный `pnpm check`, CI evidence-inclusive HEAD и отдельный production
visual GO выполняются следующим этапом; результаты публикуются в #781 и draft PR #1349.

## Снимки

| Ширина | Standalone production dialog | Реальный TariffsView в Storybook | Live `/authoring/access` |
| --- | --- | --- | --- |
| 1440 | [Dialog](production-storybook-dialog-1440.png) | [Tariffs](production-storybook-tariffs-1440.png) | [Live](production-live-1440.png) |
| 390 | [Dialog](production-storybook-dialog-390.png) | [Tariffs](production-storybook-tariffs-390.png) | [Live](production-live-390.png) |
| 320 | [Dialog](production-storybook-dialog-320.png) | [Tariffs](production-storybook-tariffs-320.png) | [Live](production-live-320.png) |

Изображения лично просмотрены исполнителем и координатором перед коммитом: текст читается,
кнопки помещаются, на мобильных расположены вертикально, фокус «Отмена» виден. Live-снимки —
viewport captures с длинным синтетическим названием тарифа; они показывают фактический route/BFF
на disposable local stack. Storybook-снимки показывают компонент и его TariffsView-композицию.
[SHA-256 изображений](production-images.json) связывает файлы с capture source.

## Фактические проверки

- Focused full-stack: 8/8 desktop/mobile cases, actual exit 0. Сохранение допуска и чтение после
  reload/new browser context идут через реальный BFF в изолированную локальную БД. Проверены
  несохранённый выбор в обе стороны, полученный revision, Cancel/Escape, confirm once и unpublish.
- Actual Storybook MCP: `stories-changed`, три batches `stories-preview`, `test-run` с a11y:
  [15/15 passing stories, exit 0](production-mcp-tests.json). [Возвращённые preview URLs](production-mcp-previews.json)
  относятся к локальному Storybook 6006; runtime остановлен после захвата.
- Все шесть Storybook captures: axe 0, page errors 0, root/dialog без горизонтального overflow,
  весь диалог внутри viewport. Trusted Tab переводит Cancel → Confirm, Shift+Tab возвращает Cancel.
  Второй forward Tab может перейти в browser chrome (`hasFocus=false`, BODY); фокус на фоновых
  контролах запрещён проверкой. Custom focus wrap не заявляется.
- Standalone dialog stories имеют `trigger=null`: `cancelRestoresTrigger=false` и
  `confirmRestoresTrigger=false` в JSON означают **не проверялось**, а не дефект возврата фокуса.
  Actual TariffsView stories проверяют native Escape, Cancel, Confirm и возврат к фактической
  кнопке. Live route проверяет начальный Cancel focus, trusted Tab/Shift+Tab на всех трёх размерах,
  native Escape и Cancel с возвратом к trigger, а также однократный confirm. Операции Escape,
  Cancel, confirm, revision и reload выполняются **после восстановления исходного
  project viewport**: 1440×1024 для desktop и 390×844 для mobile. На 320 px проверены только
  capture geometry/axe и trusted Tab/Shift+Tab. В live JSON `facts` описывает каждый capture,
  а `scenarios` отдельно описывает операции на исходном project viewport. Чтение допуска в
  дополнительном `browser.newContext` отражено отдельно в `auxiliaryContextRead`: его viewport
  не захватывался, контекст закрыт в `finally`.

[Storybook факты](production-storybook-facts.json) и [live факты](production-live-facts.json)
содержат реальные geometry/axe measurements и границы проверенного поведения. Raw logs,
MCP responses, axe reports и focus ledgers сохранены в ignored `.reports/781` собственного worktree.

## Граница синтетической публикации

Все publish **и** unpublish requests в live browser tests перехвачены. Проверяются точный
`expectedRevision`, команда и последующее состояние UI; server persistence публикации не
заявляется. Reload отдельно показывает неизменённую server publication и реально сохранённый
допуск. Storybook использует fixture callbacks. Реальные продажи, цены, платежи, доступ и
production-данные не менялись.

Собственные focused PostgreSQL/RustFS/Playwright containers, volumes, network и Storybook
container удалены после actual exit 0; порт 6006 свободен. Final checks требуют нового отдельного
выделения единственного тяжёлого слота. Принятие макета proof не является production visual GO
и не разрешает merge/deploy.
