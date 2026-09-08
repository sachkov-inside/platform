# Авторский закреп на главной — #425

Реальный опубликованный Material выбирается в авторском списке, сохраняется на сервере и
отображается первым на главной с существующим изображением автора. Серия для продолжения
обучения остаётся отдельным блоком. Исправления ширины заметок и нижней плашки находятся в #424.

## Доказательства

- `storybook-pin-*`: production Home component, desktop 1440px, mobile 390px и text 200% при 1280px.
- `storybook-authoring-*`: production авторский список, выбор и снятие закрепа, desktop/mobile.
- `live-*-authoring-pin.png`: выбранный материал после перезагрузки в реальном авторском UI.
- `live-*-home-pin*.png`: реальная главная и увеличенный текст, desktop/mobile.

Storybook geometry: первый section — featured-title, горизонтального overflow нет,
asset автора загружен (900px). Full-stack Playwright проверяет delayed pin response при уже
загруженном списке, выбор/reload/замену/снятие, guest/member, отказ неавтору, link/Reader,
закрытый доступ и отсутствие serious/critical axe findings на гостевой главной.
Использована синтетическая локальная identity, настоящие API, BFF и отдельная PostgreSQL.

Проверки: `PLAYWRIGHT_PORT=3425 pnpm check`,
`pnpm --filter @inside/backend test:integration --maxWorkers=4` (217 tests),
focused `pnpm smoke:fullstack` для Home и авторского закрепа; после исправления загрузки —
`pnpm lint`, Web typecheck и 13 Home/BFF module tests. Standards: один P2 исправлен,
итог pass; Spec: pass. Node 24.19.0.

Первоначальный широкий запуск DB tests перегрузил локальную машину (hook timeouts);
полный повтор с четырьмя workers прошёл. Это локальное доказательство, не production.
Решения владельца по визуальному результату и merge остаются открытыми.
