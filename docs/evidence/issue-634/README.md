# #634: прокрутка авторской границы ошибки

На 08.10.2026 `app/authoring/materials/error.tsx` уже удалён через #712.
Его маршруты достигают `app/authoring/error.tsx`, который импортирует клиентский
`MaterialAuthoringRouteError` через `@/_pages/route-states`. Компонент использует общий
`MaterialAuthoringStateScreen` в `widgets/material-authoring`.

В общем экране отсутствовал `overflow-y-auto`. Исправление добавляет его к `main`,
сохраняя текст, действия, отступы и авторскую оболочку.

## Доказательства

- [1440 × 900](error-1440.png): обычная ошибка в производственной авторской оболочке Storybook;
  `main` имеет ширину 1216 и высоту 900, `overflow-y: auto`.
- [390 × 844](error-390.png): тот же компонент в мобильной оболочке, ширина `main` 390.
  На обеих ширинах `documentElement.scrollWidth === documentElement.clientWidth`.
- `Pages/Authoring/Route states → Long Error Desktop` задаёт длинный код обращения.
  История проверяет вычисленный `overflow-y: auto`, переполнение по высоте,
  ширину колонки, отсутствие горизонтального переполнения, изменение `scrollTop`,
  доступность кнопки после прокрутки вниз и заголовка после возврата вверх.
  До исправления история падала: `expected 'visible' to be 'auto'`.
  После исправления все три истории проходят через Storybook MCP `test-run`.
- `pnpm --filter @inside/web guardrails` отвергает негативную фикстуру
  `error-boundary/app/authoring/materials/error.tsx` с рукописным `main`.
  До добавления правила негативная проверка падала из-за отсутствия ожидаемой диагностики.
  Корректная фикстура `app/authoring/error.tsx` использует общий компонент и принимается.

Снимки показывают производственный компонент в Storybook, а не реальный сбой маршрута.
Серверные зависимости не входят в клиентский экспорт: `route-states/index.ts`
реэкспортирует `widgets/material-authoring/route-states.ts`.
