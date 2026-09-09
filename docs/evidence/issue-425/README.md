# Авторский закреп Серии на главной — #425

Автор выбирает только Серию значком закрепа в общем списке серий. Настройка сохраняется на сервере;
на главной первой показана эта Серия с существующим изображением автора и ссылкой «Открыть серию».
Кнопок закрепа у отдельных материалов нет. Исправления заметок и плашки поставляются в PR #424.

## Доказательства

- `storybook-pin-*`: production Home, 1440px, 390px и text 200% при 1280px.
- `editor-*` и `series-list-*`: текущие отдельная страница редактора и список с закрепом, desktop/mobile.
- `live-series-editor-*`: текущий production editor с авторской навигацией, desktop/mobile.
- `live-*-authoring-pin.png`: текущий общий список после сохранения закрепа и перезагрузки.
- `live-*-home-pin*.png`: реальная главная и text 200%, desktop/mobile.

Storybook: первый section — featured-title, overflow отсутствует, аватар загружен (900px).
Full-stack Playwright проверяет loading→error→retry→ready без сдвига редактора, выбор,
перезагрузку, замену, снятие, guest/member, отказ неавтору, переход на страницу Серии,
отсутствие кнопок закрепа у Materials и serious/critical axe findings.
Использованы синтетическая identity, настоящие BFF/API и отдельная PostgreSQL. Тестовая БД удалена.

Проверки: `PLAYWRIGHT_PORT=3425 pnpm check`;
`pnpm --filter @inside/backend test:integration --maxWorkers=4`;
focused `pnpm smoke:fullstack` для Home и авторского закрепа. Node 24.19.0.
После интеграции main сохранён его полный migration prefix; существующая БД main получает только
две миграции закрепа. Ранее применявшиеся имена и SQL закрепа сохранены, порядок задаётся реестром.
DB acceptance покрывает отрицательный Material UUID, право управления, конкурирующие записи,
текущие название/описание, архив и пустой опубликованный состав, снятие и singleton constraint.

Два замечания review исправлены: стабильная высота error/retry и существующий formatter
числа материалов. Это локальное доказательство, не production; owner visual и merge GO открыты.

## Отдельная страница серии

По обратной связи владельца раскрывающаяся карточка с вложенным составом заменена отдельной
страницей. Проверены создание, редактирование метаданных, возврат после autosave, добавление,
изменение порядка, последовательностей и удаление материалов, архивирование и восстановление.
Общий список позволяет закрепить, заменить и снять закреп без открытия редактора.

`PLAYWRIGHT_PORT=3255 pnpm check` пройден. Focused `pnpm smoke:fullstack`:
`author Home pin|author edits series metadata|trusted author reorders a PostgreSQL series` —
шесть сценариев на desktop/mobile через реальные BFF/API/PostgreSQL и синтетическую identity.
Finish review: компактность mobile-строк и отдельный статус сохранения настроек исправлены,
оба замечания оценены resolved. Standards: общий порядок autosave → archive собран в hook;
Spec: несоответствий запросу владельца не обнаружено. Это локальная проверка; visual GO не получен.

Дополнительно на локальном приложении проверены pointer drag → сохранение → reload и возврат
исходного порядка demo-серии, отсутствие overflow на 390/1440px и при text 200%.
После выделения archive sequencing в hook повторены оба full-stack metadata/archive сценария.
