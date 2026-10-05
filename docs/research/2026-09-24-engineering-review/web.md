# Frontend review: platform `apps/web` и landing

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/web.md); текущие правила — [документы Platform](../../../README.md).

Дата: 2026-09-24. Режим: только статический анализ (grep/find/wc, чтение кода). Сборки, dev-серверы и
бандл-анализ не запускались, поэтому размеры бандлов не измерены. Где вывод зависит от сборки, это
сказано прямо.

Чек-лист: `.inside-harness/skills/vercel-react-best-practices` (8 категорий), `modern-web-guidance`
(LCP priority, content-visibility, `hidden="until-found"`). Нормы проекта: `apps/web/CODING_STANDARDS.md`,
ADR 0011/0012/0026.

## Итог в цифрах (apps/web)

| Метрика | Значение | Как измерено |
|---|---|---|
| Продуктовые `.ts/.tsx` в `src` + `app` (без stories/tests/workshop) | 873 файла, ~67 тыс. строк | find + wc |
| Файлы с `"use client"` | 150 (17%), 24 030 строк | grep `^"use client"` |
| …по слоям | features 71, _pages 33, widgets 16, shared 10, _app 8, entities 6, app 6 | |
| Файлы `server-only` | 128 | grep `import "server-only"` |
| `"use cache"` | 5 функций в 4 модулях `*.public-cache.server.ts` | grep |
| Нарушения слоёв FSD (импорт вверх / между срезами одного слоя) | 0 / 0 | собственный скрипт по `@/` импортам + guardrail `check-web-architecture.mjs:252-289` |
| `any` в рукописном коде | 0 (77 только в `generated/`) | grep, generated исключён |
| `as`-приведения (без `as const`) | 36 (из них 5 `JSON.parse(...) as unknown`, 3 `as Route`) | grep |
| Non-null `!` | 0 | grep |
| `@ts-ignore` / `@ts-expect-error` | 0 | grep |
| lint-disable в рукописном коде | 6 (5 × `no-img-element` с обоснованием, 1 × `exhaustive-deps`) | grep |
| Route Handlers (BFF) | 145, тонкие (3–10 строк) | find |
| `page.tsx` / `loading.tsx` / `error.tsx` / `not-found.tsx` | 34 / 11 / 5 / 4 | find |
| Страницы без `error.tsx` ни на одном уровне выше | 22 из 34 | обход дерева |
| Stories | 59 файлов, 551 story; a11y addon в режиме `test: "error"` | grep |
| e2e/fullstack-спеки с axe | 18 | grep `AxeBuilder` |
| `next/image` | 0; `<img>` — 5, все с обоснованием | grep |
| `fetchPriority` / `content-visibility` | 0 / 0 | grep |
| Строки длиннее 160 символов | 1 091 в 285 файлах | awk |
| Файлы > 500 строк | 11 (максимум 1 248) | wc |
| Форматтер (prettier/biome/dprint/oxfmt) | нет | root `package.json` |

Общая оценка: архитектура сильная и хорошо задокументированная. Слои соблюдены и охраняются guardrail.
Типизация строгая (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `typedRoutes`), escape
hatches почти отсутствуют. Кеширование (Cache Components, `"use cache"` только в `*.public-cache.server.ts`,
тег `catalog`, профили `cacheLife`) продумано и закреплено в ADR 0026. Серверные загрузки используют
`Promise.all` (14 мест), `React.cache` (4) и Suspense-слои. Серверных waterfall-ов уровня Critical не
найдено. Основные риски — клиентское поведение шапки, LCP на страницах продукта, отсутствие полевых
метрик и бюджета бандла, а на landing — шрифт без кириллицы.

---

## Platform `apps/web`

### H1. Каждый возврат во вкладку сбрасывает статус входа, и личные блоки мигают — High

**Evidence**
- `src/_app/ui/auth-status-control.client.tsx:33-45`: `refresh()` на каждое событие `focus` и `pageshow`
  сначала ставит `resolved: false`, потом делает запрос `/auth/status`.
- `src/_app/ui/app-shell.tsx:34-43,74`: `resolved` управляет `accountKnown`, `enabled` запроса
  презентации аккаунта и пробрасывается в `ReadingProgressProvider`.
- `src/features/reading-progress/ui/reading-provider.client.tsx:30,50`: при `!resolved` запросы
  прогресса выключаются, а карта `states` становится пустой.
- `src/features/reading-progress/ui/learning-continuation.client.tsx:14`: при `!resolved` блок
  «Продолжить обучение» заменяется пустым `min-h-80` плейсхолдером.
- `src/features/reading-progress/ui/saved-reading-action.client.tsx:30`: все кнопки прогресса
  переходят в `loading`.

**Почему важно.** Пользователь переключился в другое окно и вернулся. В этот момент на Главной пропадает
блок продолжения, у всех карточек пропадает прогресс, мобильная навигация на мгновение теряет аккаунт.
Если реальная высота блока не равна 20rem, это ещё и сдвиг раскладки (CLS) без действия пользователя.
Такой сброс противоречит собственному правилу `CODING_STANDARDS.md` («Hover, focus, loading, and hydration
preserve surrounding layout»). Кроме того, `/auth/status` запрашивается на каждый focus без ограничения
частоты.

**Рекомендация.** Повторная проверка не должна сбрасывать уже известный статус (stale-while-revalidate).
Держите `resolved: true` и прежние данные, пока идёт повторная проверка, и меняйте статус только при
реальном изменении `accountId`/`state`. Самый короткий путь — перевести хук на `useQuery` (TanStack уже
в оболочке) с `refetchOnWindowFocus`, `placeholderData: keepPreviousData` и `staleTime` порядка 30 с.
Добавьте Playwright-кейс: после `focus` блок продолжения не исчезает.

**Effort:** S.

### M1. Обложка в первом экране продукта грузится лениво — Medium (LCP)

**Evidence**
- `src/entities/material/ui/content-cover-image.client.tsx:79-95`: `loading="lazy"` зашит жёстко,
  параметра приоритета нет.
- `src/_pages/library-discovery/ui/guide-product-view.tsx:126-132`: обложка 16:9 внутри
  `data-product-part="hero"`, первый экран страницы продукта.
- `src/_pages/library-discovery/ui/library-discovery-view.tsx:152`: обложка темы в шапке.
- `fetchPriority` в `apps/web` встречается 0 раз.

**Почему важно.** Обложка героя на странице продукта — вероятный элемент LCP. `loading="lazy"`
откладывает её загрузку до layout, а без `fetchpriority="high"` она ещё и конкурирует со скриптами.
Изображение идёт через цепочку Next → backend → хранилище (см. L6), поэтому задержка складывается.

**Рекомендация.** Добавьте в `ContentCoverImage` параметр `priority`. При нём компонент ставит
`loading="eager"` и `fetchPriority="high"`. Передавайте его в героях продукта, программы и темы и в
первой карточке ленты. Проверьте LCP до и после в production-сборке (`test:navigation`).

**Effort:** S.

### M2. Нет корневых `not-found` и `global-error`; 22 из 34 страниц без `error.tsx` — Medium

**Evidence**
- Отсутствуют `app/not-found.tsx`, `app/global-error.tsx`, `app/(public)/error.tsx` и
  `app/(public)/not-found.tsx`.
- `notFound()` вызывается в `app/(public)/legal/[slug]/page.tsx` и
  `app/(public)/legal/[slug]/[version]/page.tsx`, но у этих сегментов нет своего `not-found.tsx`.
- `error.tsx` есть только у 4 сегментов каталога и у `authoring/materials`.

**Почему важно.** Любой неизвестный адрес и отсутствующий юридический документ показывают стандартную
страницу Next по-английски («This page could not be found»), без оболочки и навигации. Это единственное
место, где русскоязычный продукт показывает английский текст. Ошибка в `(public)/layout`, кабинете,
закладках или авторских разделах кроме материалов тоже падает в стандартную английскую страницу ошибки.

**Рекомендация.** Добавьте `app/not-found.tsx` (русский текст, ссылки на Главную и каталог) и
`app/global-error.tsx`. Добавьте `error.tsx` в `(public)` и `authoring`; для каталога сохраните правило
`retry` из ADR 0026. Покройте story и e2e-кейсом `/does-not-exist` → 404 на русском.

**Effort:** S.

### M3. Нет полевых Core Web Vitals и отчёта об ошибках; в лаборатории проверяется только CLS — Medium

**Evidence**
- `src/_app/ui/navigation-timing.client.tsx:15-35`: `useReportWebVitals` только пишет
  `performance.mark`, наружу ничего не уходит (так задумано в ADR 0026).
- `instrumentation.ts` не экспортирует `onRequestError`.
- В `instrumentation-client.ts` нет обработчика ошибок.
- `test/navigation/instant-navigation.spec.ts:294`: из порогов проверяется только `CLS < 0.1`.
  Для LCP и INP порогов нет.

**Почему важно.** Реальные LCP/INP на телефонах покупателей (Россия, мобильная сеть, один экземпляр web)
не видит никто. Ошибки рендера на сервере остаются только в stdout контейнера, клиентские ошибки
теряются. Регрессию производительности нельзя заметить до жалобы.

**Рекомендация.** Сторонняя аналитика не нужна. Отправляйте web-vitals через `navigator.sendBeacon` в
собственный same-origin Route Handler, дальше — в журнал или метрики backend. Добавьте `onRequestError`
в `instrumentation.ts` со структурированной записью. В `test:navigation` добавьте пороги LCP и INP для
Главной, продукта и урока.

**Effort:** M.

### M4. Нет бюджета клиентского JS; `zod` целиком в общем чанке оболочки — Medium

**Evidence**
- `scripts/check-web-architecture.mjs:44,736`: guardrail проверяет только, что Tiptap не попадает в
  маршруты чтения, и делает это по графу импортов. Размер бандла он не проверяет. `size-limit`,
  bundle-analyzer и порогов First Load JS нет.
- `src/_app/ui/auth-status-control.client.tsx:3,87`: полный `zod` импортируется в оболочку каждой
  публичной страницы ради одного `z.uuid()`.
- 98 не-серверных модулей импортируют `zod`; `zod/mini` не используется ни разу.
- Клиентский код: 150 модулей и 24 тыс. строк.

**Почему важно.** Стандарт упоминает «bundle limits» в guardrails, но исполняемой проверки размера нет.
Рост First Load JS публичных страниц (Главная, урок, продукт) никто не заметит. Точный вклад `zod` без
сборки не измерен; это гипотеза для проверки.

**Рекомендация.** Сохраняйте из `next build` First Load JS по маршрутам (или используйте
`next experimental-analyze`) и держите закоммиченный бюджет для 5 публичных маршрутов с проверкой в
`pnpm check`. После замера решите, нужен ли `zod/mini` для browser-адаптеров и оболочки. В
`auth-status-control` UUID можно проверить без `zod`, валидацией на границе BFF.

**Effort:** M.

### M5. Программа руководства целиком рендерится на клиенте — Medium

**Evidence**
- `src/_pages/library-discovery/ui/guide-programme-view.client.tsx:1` (155 строк, `"use client"`).
- `src/_pages/library-discovery/ui/saved-series.client.tsx:38-64`: клиентская обёртка передаёт в неё
  весь `PublishedSeriesResult`.
- Клиентская часть реально нужна только для состояния прогресса и замков из `MaterialReadingContext`.

**Почему важно.** Это публичная страница каталога. Весь состав руководства (главы, материалы, обложки,
артефакты) сериализуется в RSC-payload и заново рендерится при гидрации. HTML и данные передаются
дважды, а гидрация полного списка растягивает TBT/INP на слабых телефонах (правила
`server-serialization`, `server-dedup-props`).

**Рекомендация.** Рендерите список программы на сервере. Прогресс и замки вынесите в маленькие
клиентские острова по образцу `SavedReadingAction`: они получают только `materialId` и читают контекст.
Геометрию проверяйте существующими story `LoadsInPlace`.

**Effort:** M.

### M6. Шрифты платформы подключены через CSS-импорт `@fontsource`, без preload и метрик fallback — Medium

**Evidence**
- `app/layout.tsx:4-5`: `import "@fontsource-variable/manrope/wght.css"` и `jetbrains-mono`.
- `app/globals.css:75-76`: семейства шрифтов.
- `font-display: swap`, 6 `@font-face` на семейство.

**Почему важно.** Браузер узнаёт о woff2 только после разбора CSS, поэтому текст сначала рисуется
системным шрифтом, а потом переключается. Метрики fallback не подогнаны (нет `size-adjust`), поэтому при
смене шрифта заголовки меняют ширину и переносы, а это CLS. JetBrains Mono грузится на каждой странице,
хотя это вспомогательный шрифт.

**Рекомендация.** Используйте `next/font/local` с теми же woff2-файлами: кириллица и латиница, preload
только Manrope, `adjustFontFallback`. Шрифт остаётся self-hosted, CSP (`font-src 'self'`) не меняется.

**Effort:** S.

### M7. Нет форматтера; 1 091 строка длиннее 160 символов — Medium (качество кода)

**Evidence**
- В корневом `package.json` нет prettier, biome, dprint или oxfmt.
- Больше всего длинных строк в `src/features/billing-admin/ui/tribute-operations-view.client.tsx`
  (44), `process-artwork-scenes.tsx` (31), `ai-first-guide-view.tsx` (26),
  `entities/material/ui/material-card.tsx` (25).
- Примеры логики в одну строку: `src/_app/ui/app-shell.tsx:74-75`,
  `reading-provider.client.tsx:49-51`.

**Почему важно.** Стиль зависит от автора (агента). Условия и JSX-ветки в одной строке на 250+ символов
плохо читаются в review. Diff-ы шумят, когда один агент переносит строки, а другой нет.

**Рекомендация.** Это решение владельца. Подключите форматтер (oxfmt подходит к уже используемому
oxlint), сделайте один коммит форматирования, добавьте `.git-blame-ignore-revs` и проверку в `pnpm lint`.

**Effort:** M (разовый шумный diff).

### L1. `agentation` (devDependency) в графе корневого layout — Low

**Evidence.** `app/layout.tsx:7,23,29`, `src/_app/ui/development-feedback-overlay.client.tsx:3`:
статический `import { Agentation } from "agentation"`. В production компонент не рендерится
(`readWebRuntimeMode() === "development"`), но модуль входит в production-граф клиентских ссылок.

**Почему важно.** Production-сборка зависит от devDependency: Dockerfile ставит все зависимости, поэтому
сейчас это работает. Если режим среды настроен неверно, оверлей в production начнёт отправлять данные
на `127.0.0.1:4747`.

**Рекомендация.** Импортируйте через `next/dynamic` внутри ветки разработки или защитите проверкой
`process.env.NODE_ENV === "development"`, которую бандлер вырежет. Так сделано на landing
(`agentation.ts:4`).

**Effort:** S.

### L2. Расчёт цены — «мутация» из эффекта с подавленным `exhaustive-deps` — Low

**Evidence.** `src/features/billing-checkout/ui/checkout-flow.client.tsx:172-178`: единственное
рукописное подавление правила хуков. Идемпотентное чтение (quote) вызывается через `useMutation` из
`useEffect` с ref-защитой.

**Рекомендация.** Используйте `useQuery` с ключом `[paymentOptionId, revision]` и
`enabled: oneTime`. Дедупликация, повтор и отмена тогда даются бесплатно, и подавление правила уходит.

**Effort:** S.

### L3. Доступность авторских полей и отсутствие lint-правил a11y — Low

**Evidence**
- `src/widgets/material-authoring/ui/material-document-editor.client.tsx:574` (поиск блока) и
  `material-asset-node-view.client.tsx:180`: `outline-none` без стиля фокуса (WCAG 2.4.7).
- Override для web в `.oxlintrc.json` подключает только плагины `nextjs` и `react`; `jsx-a11y` нет.

**Что уже хорошо.** Storybook a11y работает в режиме `test: "error"`. axe есть в 18 спеках. 162
`aria-live`/`role=status|alert`. `prefers-reduced-motion` учитывается в 65 местах. Есть ссылка «Перейти
к содержанию» (`application-shell.client.tsx:69`). Положительных `tabIndex` и `div onClick` нет.

**Рекомендация.** Добавьте `focus-visible:ring` этим двум полям и подключите плагин `jsx-a11y` в oxlint
для `apps/web`.

**Effort:** S.

### L4. Заголовки вкладок непоследовательны и частично на английском — Low

**Evidence.** Корневой шаблон `%s · Sachkov Inside`, но:
- `app/authoring/communications/page.tsx:2` даёт «Воронки Telegram — Inside · Sachkov Inside»;
- `app/authoring/billing/page.tsx:6` даёт «Оплата и права · Authoring · …»;
- «Preview черновика», «Редактор Material».

i18n-фреймворка нет, для продукта только на русском это нормально.

**Рекомендация.** Уберите суффиксы « — Inside» и « · Authoring» (или задайте для authoring свой
`title.template` в `app/authoring/layout.tsx`). Переведите «Preview» и «Material».

**Effort:** S.

### L5. Граница клиента объявлена без необходимости и нарушено правило имён — Low

**Evidence**
- `src/features/bookmarks/model/bookmark-action-view.ts:1`: `"use client"` в файле, где только типы.
- 7 файлов в `src` с `"use client"` без суффикса `.client`, вопреки `CODING_STANDARDS.md`
  («use `*.client.tsx` for the interactive boundary»): `app-shell.tsx`, `shared/ui/select.tsx`,
  `shared/ui/sidebar.tsx`, `use-autosave.ts`, `use-material-block-controls.ts`,
  `material-publication-action-button.tsx`, `bookmark-action-view.ts`.
- `billing-history.client.tsx` и `subscription-grounds.client.tsx` не используют хуки и события и
  импортируются только из клиентских родителей.

**Рекомендация.** Уберите директиву из файлов без интерактивности, переименуйте остальные. Добавьте в
`check-web-architecture` правило «`"use client"` ⇔ `.client.`».

**Effort:** S.

### L6. Публичные изображения идут через Node-процесс web без CDN — Low (измерить)

**Evidence**
- `app/api/content-covers/[coverId]/[width]/route.ts` →
  `src/features/content-covers/api/content-cover-bff.server.ts:29-54` →
  `src/shared/api/backend/backend-proxy-response.server.ts:3-17`: заголовки копируются из backend,
  байты стримятся через web.
- По ADR 0026:128 web работает в одном экземпляре, кеш в памяти процесса.

**Почему важно.** Каждый первый показ обложки проходит путь браузер → Caddy → Next → Nest → хранилище, и
этот трафик конкурирует с SSR того же процесса. Повторные показы спасает `cache-control` от backend.

**Рекомендация.** Замерьте TTFB обложек. Если он заметен, кешируйте `/api/content-covers/*` и
`/api/materials/*/images/*` на уровне Caddy или отдавайте публичные обложки напрямую из хранилища или
CDN.

**Effort:** M.

### L7. Опора на нестабильные API Next — Low

**Evidence**
- `unstable_dynamicStaleTime` на 5 страницах.
- `partialPrefetching: true` и `instant` в 22 сегментах (`next.config.ts`, ADR 0026).

Риск снижает точный пин `next: 16.3.4`.

**Рекомендация.** Держите в ADR 0026 список нестабильных API и проверку при обновлении Next.
`test:navigation` это уже частично покрывает.

**Effort:** S.

### L8. Пробелы в Storybook — Low

**Evidence.** Всего 59 файлов и 551 story. Нет stories для страниц:
- `account-notifications`, `account-purchases`, `account-subscription`;
- `welcome`, `map`;
- `features/reading-progress` (6 tsx), `features/material-lifecycle`, `entities/legal-document`.

Часть срезов покрыта через `src/workshop` (series-order, material-authoring).

**Рекомендация.** Добавьте page-level stories для трёх разделов кабинета и страницы welcome, где есть
состояния загрузки и ошибок.

**Effort:** S-M.

### L9. Генератор OpenAPI-клиента — `openapi-typescript-codegen` 0.31.0 — Low

**Evidence**
- `apps/web/package.json` (devDeps).
- `src/shared/api/backend/generated`: 34 файла, 440 КБ, классы `CancelablePromise` и `BaseHttpRequest`,
  77 `any`.
- Клиент используется только на сервере для формы запроса (`transport-core.server.ts:11-21`). Ответы
  приходят как `unknown` и валидируются Zod, как требует стандарт. Это хорошо.

**Почему важно.** Upstream-проект не развивается, его README указывает на форк `@hey-api/openapi-ts`.
Любая новая возможность OpenAPI (например, discriminator или binary streaming) может потребовать
обходных путей.

**Рекомендация.** Срочно ничего делать не нужно. При следующей потребности в изменении генератора
переходите на `@hey-api/openapi-ts` или `openapi-typescript` + `openapi-fetch`, сохранив детерминированную
проверку `openapi:check`.

**Effort:** M.

### L10. Крупные клиентские компоненты authoring — Low

**Evidence**
- `src/features/series-order/ui/series-order-manager.client.tsx` — 1 248 строк.
- `src/_pages/communications/ui/communications-workspace.client.tsx` — 1 135.
- `src/widgets/material-authoring/ui/material-document-editor.client.tsx` — 777.
- Всего 11 файлов больше 500 строк.

Всё это авторская часть, публичный бандл не затронут.

**Рекомендация.** Делите по видимым подсостояниям при следующей содержательной правке, отдельной задачей
не нужно.

**Effort:** M.

### L11. Контекст прогресса пересоздаётся на каждый рендер оболочки — Low

**Evidence.** `src/features/reading-progress/ui/reading-provider.client.tsx:28-33,49-51`: `useQueries`
без `combine`, новый `Map` и новый объект `value` на каждый рендер. Все потребители (каждая
`SavedReadingAction` и `VisibleMaterialOpen`) перерисовываются при смене `pathname`, статуса входа и
т. п. (правило `rerender-*`).

**Рекомендация.** Используйте `combine` в `useQueries`, `useMemo` для value или разделите контекст на
стабильные действия и состояния по `materialId`. Это стоит сделать вместе с H1.

**Effort:** S.

### Что сделано хорошо (оставить как есть)

- Слои FSD: 0 нарушений, guardrail с негативными fixtures. `app/` тонкий. 145 BFF-обработчиков по 3–10
  строк.
- Server/client: 128 `server-only`. Браузер ходит только в same-origin BFF (ADR 0011/0012). Server
  Actions осознанно не используются.
- Waterfalls: `MaterialReaderPage` параллелит чтения (`material-reader-page.tsx:57-60,127-138`). Поиск
  предложения для гостя стартует до личного чтения. `generateMetadata` и страница дедуплицируются через
  `React.cache` (`load-material-reader.ts:8`) и `"use cache"`.
- Кеш: только гостевые чтения, тег `catalog`, отдельные профили для «не найдено» и «сбой»
  (`catalog-cache.server.ts:22-28`), инвалидация после авторских записей.
- Tiptap изолирован от маршрутов чтения. `tus-js-client` и Kinescope loader подключаются через
  `await import()`.
- Типизация: 0 `any`, 0 `!`, 0 ts-ignore, typed routes (3 `as Route`), явные типы props у маршрутов.
- Изображения: собственные WebP-рендиции с `srcSet`, `sizes`, `width`/`height` и резервом места
  (`aspectRatio`).

---

## Landing `landing/app` (Astro 7)

Масштаб: 1 страница, 11 компонентов, 2 inline-скрипта (5,8 КБ + 6,3 КБ исходника), `global.css` 40 КБ.
Фреймворк-JS в production нет.

### LA1. Основной шрифт Space Grotesk не содержит кириллицы; шрифты грузятся с Google — High

**Evidence**
- `src/styles/global.css:10,27`: `body { font-family: 'Space Grotesk', 'Helvetica Neue', Arial }`.
- `src/layouts/BaseLayout.astro:61-66`: Google Fonts, render-blocking `<link rel="stylesheet">`.
- Ответ `fonts.googleapis.com/css2?family=Space+Grotesk…` содержит только поднаборы `vietnamese`,
  `latin-ext` и `latin`. У JetBrains Mono `cyrillic` есть.

**Почему важно.** Весь русский текст landing рисуется системным Helvetica Neue или Arial, а латинские
слова в той же фразе («production-разработка», «AI-агентами», «Fullstack») — Space Grotesk. Получается
смешение гарнитур в каждой строке, и фирменный заголовочный шрифт русскому тексту не достаётся. Вдобавок
это кросс-доменный CSS, блокирующий рендер, два дополнительных соединения и передача IP посетителя в
Google. Последнее — вопрос доступности из РФ и персональных данных, его стоит проверить с владельцем.

**Рекомендация.** Это решение владельца или дизайна. Выберите заголовочный шрифт с кириллицей. Для
единства с платформой подходит Manrope, либо можно подобрать гротеск похожего характера. Разместите
шрифты у себя (`@fontsource` или Astro Fonts API), сделайте preload одного критичного woff2 и уберите
Google Fonts.

**Effort:** S-M.

### LA2. Свёрнутые ответы FAQ остаются в дереве доступности — Low

**Evidence**
- `src/styles/global.css:1275-1282`: свёрнутость сделана через `grid-template-rows: 0fr` +
  `overflow: hidden`, без `hidden` или `inert`.
- `src/scripts/behaviors.js:76-90`: скрипт переключает только класс и `aria-expanded`.

**Почему важно.** Скринридер читает «свёрнутые» ответы, а `aria-expanded="false"` этому противоречит.
Поиск по странице (Ctrl+F) находит скрытый текст, но не раскрывает панель.

**Рекомендация.** Используйте `hidden="until-found"` с обработчиком `beforematch` (как советует
`modern-web-guidance`) или `<details>/<summary>`. Анимацию можно сохранить.

**Effort:** S.

### LA3. Node 22 с верхней границей `<23`, а платформа на Node 24 — Low

**Evidence**
- `app/package.json`: `"engines": { "node": ">=22.12.0 <23" }`.
- `.github/workflows/ci.yml:18`: `node-version: 22.23.1`.
- Платформа: `.node-version` = 24.19.0, Dockerfile `node:24.19.0-alpine3.23`.
- Зависимости landing указаны диапазонами `^`, а платформа пинит точные версии (lockfile на landing
  есть).

**Почему важно.** Node 22 поддерживается до апреля 2027. Верхняя граница `<23` запрещает Node 24 без
технической причины: Astro требует только `>=22.12`. Два разных рантайма в одном продукте означают две
матрицы обновлений.

**Рекомендация.** Если Timeweb позволяет, снимите верхнюю границу и переведите CI на 24.x. Причину
текущего пина стоит записать рядом (например, ограничение хостинга). Пиньте точные версии, как в
платформе.

**Effort:** S.

### LA4. React и agentation в devDependencies — это правильно (Info)

**Evidence.** `src/scripts/agentation.ts:4-9`: всё загружается через `await import()` внутри
`if (import.meta.env.DEV)`, в production-сборке эта ветка вырезается. Типы `AgentationProps` и
`ComponentType` импортируются как `import type`.

**Рекомендация.** Добавьте в `scripts/verify-production.mjs` проверку, что в `dist/_astro/*.js` нет
`react-dom` и `agentation`. Так поломка DCE не пройдёт тихо.

**Effort:** S.

### LA5. Изображения из `public/` без хеширования и ресайза — Low

**Evidence**
- `public/assets`: 8 PNG-fallback на 5,6 МБ (например, `author.png` 1,12 МБ) рядом с WebP на 50–134 КБ.
- `<picture>` с одним размером WebP, без `srcset` по ширине и без AVIF.
- `astro:assets` не используется.

**Почему важно.** Файлы без хеша в имени нельзя кешировать как `immutable`. PNG-fallback почти никому не
нужны: WebP поддерживают все актуальные браузеры. При этом hero уже сделан правильно: preload WebP +
`fetchpriority="high"`, у остальных `loading="lazy"` и размеры.

**Рекомендация.** Используйте `<Picture>` из `astro:assets` с `formats={['avif','webp']}` и `widths`.
PNG-fallback удалите (кроме `og.png`).

**Effort:** S-M.

### LA6. SEO и мета — хорошо (Info)

`verify-production.mjs` проверяет canonical, OG, Twitter, JSON-LD `WebSite`, `robots` и `sitemap`.
Возможные улучшения: `lastmod` в sitemap и JSON-LD `Person` или `Organization` отдельным узлом.
Приоритет низкий.
