# Авторский закреп Серии на главной — #425

Автор выбирает только Серию в редакторе её состава. Настройка сохраняется на сервере;
на главной первой показана эта Серия с существующим изображением автора и ссылкой «Открыть серию».
Кнопок закрепа у отдельных материалов нет. Исправления заметок и плашки поставляются в PR #424.

## Доказательства

- `storybook-pin-*`: production Home, 1440px, 390px и text 200% при 1280px.
- `storybook-authoring-*`: production управление выбранной Серией, desktop/mobile.
- `live-*-authoring-pin.png`: реальный редактор Серии после сохранения и перезагрузки.
- `live-*-home-pin*.png`: реальная главная и text 200%, desktop/mobile.

Storybook: первый section — featured-title, overflow отсутствует, аватар загружен (900px).
Full-stack Playwright проверяет loading→error→retry→ready без сдвига редактора, выбор,
перезагрузку, замену, снятие, guest/member, отказ неавтору, переход на страницу Серии,
отсутствие кнопок закрепа у Materials и serious/critical axe findings.
Использованы синтетическая identity, настоящие BFF/API и отдельная PostgreSQL. Тестовая БД удалена.

Проверки: `PLAYWRIGHT_PORT=3425 pnpm check`;
`pnpm --filter @inside/backend test:integration --maxWorkers=4` — 217 tests / 35 files;
focused `pnpm smoke:fullstack` для Home и авторского закрепа. Node 24.19.0.
DB acceptance покрывает отрицательный Material UUID, право управления, конкурирующие записи,
текущие название/описание, архив и пустой опубликованный состав, снятие и singleton constraint.

Два замечания review исправлены: стабильная высота error/retry и существующий formatter
числа материалов. Это локальное доказательство, не production; owner visual и merge GO открыты.
