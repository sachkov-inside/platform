# Reader: внедрение принятой панели A, #1591

Владелец принял A на desktop и mobile, затем поручил внедрение, merge и закрытие
[#1591](https://github.com/sachkov-inside/platform/issues/1591). На уточнение о внедрении A
в рабочий Reader он ответил «да». Реализация подготовлена в [PR #1594](https://github.com/sachkov-inside/platform/pull/1594).
Production visual GO и обязательный final-head CI пока ожидаются. Deployment не назначен.

## Источник принятого направления

[Прототип и решение владельца](https://github.com/sachkov-inside/platform/blob/9b4c7ce9347ca65f571e2b2265d90a3e48b8efbf/docs/evidence/issue-1591/README.md)
сохранены на отдельной `prototype/1591-reader-actions`.
[Запись назначения в задаче](https://github.com/sachkov-inside/platform/issues/1591#issuecomment-6286811825)
связывает proof с production-работой. Демонстрационные компоненты в main не переносятся.

Подготовленная реализация: `92683d4c962e5b95d621ae9d62041f58ee126200`.
Production source последний раз менялся в `7c4a71b48e2f63de7d690651911e71742c7330ba`;
следующий коммит меняет только интерактивную Storybook fixture и её проверки.
Base и trusted policy: `2f5300026c5a3e946f30596262a02747c6f48827`, `docs/agents/change-risk.md`.

## Результат

Back, Save, Studied, Share сгруппированы слева, Next справа. Действия повторены после текста
и заданий. При отсутствии следующего шага Next не показывается. На широком экране видны
подписи, на узком второстепенные действия сокращаются до доступных значков.
При нехватке места, увеличенном тексте и дополнительных действиях восстановления панель
может занять несколько строк без пересечения кнопок.

Существующие обработчики закладок, изучения и отправки, общие состояния и вычисленные ссылки
не заменялись. Share по-прежнему использует каноническую ссылку, системное меню, clipboard и
ручное копирование при отказе. Результат и поле ручного копирования находятся у активной панели.
Новые presentation props Bookmark и Share включаются только в Reader; прежние callers
сохраняют свои подписи и вид.

Pending/access сохраняют геометрию верхней панели. Кнопка Share убрана из повторяющегося
header и размещена в панели. Изменения не затрагивают sidebar, выбор главы, мобильный dock,
публикацию, доступы, backend/BFF contracts, migrations и shared local stand.

## Проверки

Шов проверки: production `MaterialReaderView` с настоящими `SavedReadingAction`,
`SavedBookmarkAction` и `MaterialShareButton`; внешние ответы в Storybook заменены fixtures.
Сначала новая проверка Grouped Reader Actions упала на отсутствии «Сохранить», после
реализации прошла. Проверки двух замечаний ревью также воспроизвели дефекты до исправления.

- На `a95b26067`: 134 focused Storybook cases прошли, включая Reader, bookmark и Share states.
- На том же source production-build navigation: 11 passed, 1 intentionally skipped
  (desktop sidebar case не применяется к mobile). Проверены панели, canonical Share,
  clipboard failure, hydration readiness, Next absent и сохранение sidebar при переходах.
- На `92683d4c9` прошли 137 финальных focused Storybook cases. Отдельный запуск трёх
  regression cases для S1/P1 также прошёл. Повторный production-build navigation после
  исправлений на этом же source: 11 passed, 1 intentionally skipped, exit code 0.
- На `92683d4c9`: `tsc --noEmit`, focused oxlint и `pnpm docs:check` прошли.
- Browser review той же production-owned Storybook presentation на 1440, 820, 390 и 320 px:
  ручное переключение Studied в обе стороны синхронизировало панели; пересечений кнопок и
  горизонтального переполнения нет; axe WCAG 2/2.1 A/AA дал ноль нарушений.
  [Результаты](production/story-browser-results.json).
- Web architecture и negative guardrails прошли до CSS-only review fixes. Изменения исправлений
  не меняют imports и adapter boundaries. Полная обязательная CI coverage проверяется в PR.

Storybook: [desktop](http://localhost:6019/?path=/story/pages-material-reader-actions--grouped-reader-actions),
[mobile 390×844](http://localhost:6019/?path=/story/pages-material-reader-actions--grouped-reader-actions-mobile).
Это production-owned компоненты с тестовыми ответами, без записей в реальные данные.

Снимки Storybook: [desktop](production/story-desktop.png), [tablet](production/story-tablet.png),
[mobile top](production/story-mobile-top.png), [mobile bottom](production/story-mobile-bottom.png).
Снимки live route после сборки исправленного source: [desktop](production/route-desktop-top.png),
[tablet](production/route-tablet-top.png), [mobile top](production/route-mobile-top.png),
[mobile bottom](production/route-mobile-bottom.png), [320 px](production/route-small-mobile-top.png).
Снимки показывают viewport. На live route виден существующий cookie notice первого посещения;
его оформление не менялось.
Изолированный navigation harness использует настоящий Next production build и fake backend;
он доказывает presentation/navigation, не реальные backend persistence effects.

## Standards

Независимый read-only review `2f5300026...a95b26067` выявил **S1, P2**: при 200% тексте
в контейнере 262 px элементы перекрывались. Исправлено в `7c4a71b48` общим переносом flex-групп.
Повтор Chromium-воспроизведения с точным CSS: `scrollWidth=clientWidth=262`, пересечений нет.
Targeted review `7c4a71b48...92683d4c9` не выявил новых нарушений.

## Spec

Независимый read-only review того же source выявил **P1, P2**: действие «Обновить статус»
после конфликта Studied перекрывало Next на 390/320 px. Исправлено в `7c4a71b48`.
Повтор на настоящем Storybook подтвердил отсутствие пересечений в обеих панелях при конфликте,
а также при 200% тексте. Fixture-only review `92683d4c9` подтвердил сброс параметров между stories
и синхронизацию в обе стороны. Других подтверждённых Spec findings нет.

Итого: Standards 1 finding, исправлен; Spec 1 finding, исправлен. Открытых findings нет.

## Классификация и оставшиеся условия

Risk и owner participation оценены двумя независимыми read-only workers на planned scope и
actual diff `a95b26067` по trusted policy выше. Результаты сохраняют применимость после UI-only
fixes и fixture-only follow-up; эти изменения дополнительно просмотрены reviewers.

Risk: **medium**, обратимое изменение интерфейса. Security review не требуется: trust boundaries,
правила доступа, payload, mutation guards и canonical URL generation не менялись.
Проверки state/retry/conflict и sharing обязательны. Изменения standards описывают принятый UI,
не меняют verification или owner authority.

Owner participation: implementation и merge назначены; перед merge нужен отдельный
**production visual GO** на эту реализацию по `docs/agents/frontend-delivery.md`.
Принятый прототип не заменяет GO, final-head CI и merge queue. Закрытие #1591 назначено после merge.
Противоречий классификаторов нет. Проверки и visual GO пока не считаются завершёнными.

## Full-stack regression selectors

CI run `39395463211` выявил пять full-stack failures в каждом browser profile:
проверки всё ещё искали прежние названия «Открыть программу» внутри панели и «Следующий урок».
В принятой панели соответствующие ссылки называются «Назад» и «Дальше».
Обновлены только locators в `test/support/linear-programme.ts` и helper `readerNextLink`;
точные проверки programme URL, occurrence identity, page, Material и dock сохранены.
Production source и визуальное evidence не изменились. Подтверждение исправления ожидается
в новом final-head CI, старый failed run не считается успешным.

## Source-anchor regression oracle

В том же CI run пять desktop navigation cases достигали правильного заголовка на `176.97px`,
но старый oracle требовал `<160px`. Заголовок имеет `scroll-mt-24`, desktop scroller начинается
под шапкой. Проверка теперь учитывает фактическую позицию scroll owner, `scroll-margin-top`
и `scroll-padding-top`, а также требует полной видимости заголовка. Native navigation code
не изменялся. Локально на финальной production UI сборке все десять source-anchor cases
(desktop/mobile) прошли, включая повторный fragment, retained hidden page и unknown fragment.
Новый final-head CI остаётся обязательным.

## Ресурсы

Storybook этой сессии оставлен на `6019`, PID `79792` на момент проверки, cwd этой рабочей
копии `apps/web`. При изменении PID сверить listener и cwd. Перезапуск из корня ветки:

```bash
pnpm --filter @inside/web exec storybook dev --port 6019 --ci --no-open
```

Чужие процессы и общий stand сохраняются. Собственные браузерные сессии закрыты.
Navigation harness сам останавливает свои процессы. До owner review Storybook сохраняется;
после завершения при подтверждённом PID его можно остановить `kill -TERM 79792`.
