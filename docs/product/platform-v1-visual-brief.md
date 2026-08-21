# Sachkov Inside Platform v1 — provisional visual brief

Статус: owner-calibrated input от 2026-08-21 для
[Platform issue #21](https://github.com/sachkov-inside/platform/issues/21).

Этот документ фиксирует рабочий visual character, preference axes, annotated references,
anti-references и процесс последующей реализации. Он не является pixel-perfect specification:
конкретная композиция, palette, typeface, navigation shell, motion timing и component strategy
доказываются поэтапно на реальных responsive surfaces.

Structural UX authority остаётся в
[Platform v1 UX brief](platform-v1-ux-brief.md). Следующий
[visual concept ticket #22](https://github.com/sachkov-inside/platform/issues/22) сравнивает
полноценные concepts, а
[component strategy ticket #23](https://github.com/sachkov-inside/platform/issues/23) выбирает
primitives/libraries только после принятого concept.

## 1. Subject, audience и jobs

Platform — живая инженерная мастерская и канонический дом полноценных Materials Inside, а не
линейный курс, dashboard метрик или ещё один documentation portal. Product scope и полный surface
inventory принадлежат [Platform MVP brief](platform-mvp-brief.md) и
[Platform v1 UX brief](platform-v1-ux-brief.md); здесь зафиксированы только jobs одинаковых
representative fixtures для следующего visual comparison.

| Prototype surface | Audience | Single job |
|---|---|---|
| Library / search | Visitor или member, который самостоятельно ищет направление | Найти один релевантный published Material через search и реальные filters |
| Long-form / video Material | Reader с разрешённым body state | Сосредоточенно прочитать или посмотреть один Material, используя локальную navigation и доступные Resources |
| Author editor | Owner-author | Изменить content и metadata одной revision, понимая validation и save state |
| Author Preview | Owner-author | Проверить exact revision в реальном reading order до отдельного publish GO |

## 2. Owner-confirmed visual constraints

Подтверждено owner:

- Platform остаётся узнаваемо связанной с текущим Sachkov Inside landing, но не копирует его
  marketing composition.
- Базовое ощущение — light, calm, modern, rounded и uncluttered.
- Контент и работа пользователя важнее chrome; reading surface не превращается в набор карточек.
- Округлые поверхности, мягкая depth hierarchy и pill-like controls допустимы, если их форма
  кодирует grouping/action, а не является decoration everywhere.
- Orange/charcoal contrast, технические mono accents, subtle dot texture и restrained
  retro-computing imagery являются возможными family traits landing, но их точная дозировка не
  зафиксирована.
- Platform должна ощущаться живой через реальные content/state changes, отзывчивость и purposeful
  motion, а не через постоянное декоративное движение.
- Video Material проверяет chapters/timecodes и удобный reading context. Owner назвал comments и
  Practice будущими inputs, но этот brief не создаёт для них v1 surfaces, controls или reserved
  layout.
- Visual implementation идёт поэтапно, surface за surface, с явным owner review до расширения
  решения на весь продукт.
- Generated mockups и внешние references задают направление и quality bar, но не являются
  обязательными screenshot specifications.

### Decision provenance

Owner передал текущий landing как существующий family context, rounded light dashboard screenshot
как mood reference и выбрал hypothesis `1` — H1 Soft Technical Workshop — стартовой из трёх
предложенных направлений. Owner отдельно уточнил, что направление нужно реализовывать постепенно,
с его контролем, используя подходящие libraries и current best practices, но не считать ни один
reference точной финальной спецификацией.

Названия hypotheses, signature ideas, risks, reference annotations и способы proof ниже являются
agent synthesis на основе этих inputs. Они остаются проверяемыми предположениями до rendered
owner review.

### Structured calibration record

| Calibration input | Owner signal | Зафиксированный результат |
|---|---|---|
| Existing landing против dashboard mood reference | Сохранить узнаваемый стиль landing примерно; предпочесть более спокойный, light, rounded, modern и uncluttered product UI | Landing остаётся family context; dashboard задаёт только mood/shape/density signals |
| H1 против H2 | Owner выбрал вариант `1` из представленных hypotheses без отдельного rationale | H1 выше H2 как текущий starting point; приписывать owner конкретную причину нельзя |
| H1 против H3 | Owner выбрал вариант `1` из представленных hypotheses без отдельного rationale | H1 выше H3 как текущий starting point; приписывать owner конкретную причину нельзя |
| H2 против H3 | Owner не дал предпочтения и попросил не превращать approximate direction в точную final reference | Pairwise outcome — tie; оба остаются равноценными alternatives для настоящего concept comparison в #22 |
| Exact reference против adaptable direction | Реализовывать поэтапно под owner control, не считать reference точной спецификацией | Ни один mockup/source не получает pixel authority; решения подтверждаются на rendered surfaces |

Итоговый rank для текущего handoff: `H1 > H2 = H3`. Это достаточный taste signal для создания
разных concepts, но не final visual selection.

## 3. Preference axes

| Axis | Working preference | Что это означает |
|---|---|---|
| Light ↔ dark | Light canvas, bounded dark workbench regions | Dark допустим для video/code/focus regions, но не становится default application theme |
| Calm ↔ energetic | Calm base, energetic state accents | Orange и motion показывают действие/current state, а не заполняют каждый viewport |
| Rounded ↔ sharp | Soft rounded grouping | Radius language должна быть ограниченной и последовательной; не каждый текст получает card |
| Spacious ↔ dense | Moderate, content-led density | Чтению нужен воздух; navigation, metadata и timecodes остаются scan-friendly |
| Editorial ↔ tool-like | Read first, Operate where task demands | Material recedes around content; authoring exposes stronger controls |
| Static ↔ alive | Real state and transition evidence | New/updated, continue, read state, save feedback и navigation context важнее ambient animation |
| Global ↔ contextual navigation | Minimal global shell plus contextual tools | Sidebar/header/bottom navigation выбираются по evidence, а не заранее как один universal layout |

## 4. Annotated reference board

References ниже дают отдельные disciplines. Ни один source не копируется целиком и не получает
authority над product truth.

### [Current Sachkov Inside landing](https://sachkov.dev/) · [source](https://github.com/sachkov-inside/inside-landing)

**Role:** existing brand family.

- **Typography / scale:** strong sans display hierarchy plus compact mono utility accents; keep the
  contrast, reduce hero-sized type in application surfaces.
- **Density / grid / spacing:** generous centered composition and deliberate whitespace; do not
  repeat marketing section rhythm or card every content block.
- **Navigation:** compact floating pill is a useful family signal, not proof that Platform needs the
  same global header.
- **Color / imagery:** warm light canvas, orange/charcoal contrast, restrained dots and
  retro-computing editorial imagery; do not require an illustration per Material.
- **Code / media:** dark workbench regions can connect code/video to the brand; landing does not
  prove long-form artifact treatment.
- **Motion / tone:** confident and friendly technical tone; avoid CTA-driven motion and decorative
  section numbering inside the application.

### [GitHub Docs](https://docs.github.com/en)

**Role:** long-form engineering reading.

- **Typography / scale:** predictable heading ladder and readable body/code distinction; avoid a
  generic documentation identity.
- **Density / grid / spacing:** stable reading column with nearby local context; do not preserve
  desktop navigation density at every viewport.
- **Navigation:** breadcrumbs, table of contents and explicit current location are useful Material
  patterns; deep permanent trees are not a Platform default.
- **Color / imagery:** quiet neutral chrome keeps attention on content; lack of expressive imagery
  is not a brand target.
- **Code / media:** bounded code, callouts and resources support technical scanning; media-library
  discovery is outside this reference's role.
- **Motion / tone:** restrained feedback and utilitarian tone; Platform may feel warmer and more
  authored.

### [Stripe Docs](https://docs.stripe.com/)

**Role:** engineering artifacts with complex local context.

- **Typography / scale:** compact labels coexist with highly readable technical body; do not copy
  documentation-specific naming density.
- **Density / grid / spacing:** strong column alignment and proximity between explanation and
  artifact; avoid dual-pane density when there is no active artifact.
- **Navigation:** active local navigation and explicit position help long Materials; product
  taxonomy is not Platform IA.
- **Color / imagery:** color is mostly functional state/brand emphasis; avoid importing Stripe's
  visual identity or decorative gradients.
- **Code / media:** adjacent code/action treatment is the main signal; video chapters and content
  discovery need separate proof.
- **Motion / tone:** precise, immediate interaction feedback and authoritative tone; avoid making
  reading feel like operating an API console.

### [Apple Developer Videos](https://developer.apple.com/videos/)

**Role:** technical media library and session discovery.

- **Typography / scale:** session title and event/topic metadata form a clear scan hierarchy; avoid
  oversized promotional titles in result lists.
- **Density / grid / spacing:** repeatable media units support browsing while retaining whitespace;
  do not turn every Material into an image-led tile.
- **Navigation:** topic/event filters and collection context are useful media-discovery evidence;
  Apple's conference taxonomy is not Platform taxonomy.
- **Color / imagery:** thumbnails carry differentiation while surrounding chrome stays quiet;
  Platform must remain useful when optional media is absent.
- **Code / media:** video is a first-class technical artifact connected to session context; exact
  player, chapters and transcript behavior still require prototype proof.
- **Motion / tone:** calm catalog behavior and editorial technical tone; avoid event-promo cadence.

### [Notion](https://www.notion.com/product)

**Role:** authoring and calm workspace.

- **Typography / scale:** content-first hierarchy with low-chrome controls; do not inherit a blank
  universal-page aesthetic.
- **Density / grid / spacing:** generous canvas with contextual controls; editor metadata and
  validation cannot disappear for visual calm.
- **Navigation:** progressive disclosure is useful in authoring; Notion workspace topology is not
  Platform information architecture.
- **Color / imagery:** neutral base lets authored content lead; do not copy AI feature chrome or
  emoji-driven identity.
- **Code / media:** mixed blocks show how artifacts can sit in one reading order; exact Platform
  schema and Preview remain authoritative.
- **Motion / tone:** low-friction direct manipulation and quiet tone; hidden affordances must stay
  keyboard-accessible and discoverable.

### [Linear](https://linear.app/)

**Role:** responsive product feedback and living state.

- **Typography / scale:** compact labels and strong scan hierarchy work at higher density; Material
  body must remain more relaxed.
- **Density / grid / spacing:** consistent rhythm makes many states legible; task-table density is
  not a reading target.
- **Navigation:** fast contextual transitions preserve location; issue/project topology is not a
  Platform shell reference.
- **Color / imagery:** restrained accent color marks state; dark productivity-tool identity and
  glow are not targets.
- **Code / media:** not a content/media reference; use only its state-feedback discipline.
- **Motion / tone:** purposeful, brief transitions make state change visible; avoid constant
  activity noise or productivity urgency.

### Owner-provided mood screenshot

Owner также предоставил screenshot светлого fitness dashboard с крупными rounded panels, soft
depth и спокойной density. Надёжный public source URL найти не удалось, поэтому screenshot не
перепубликуется и не считается durable reference-board source.

Из него подтверждены только preference signals: calm light shell, generous rounding, modular
hierarchy и отсутствие визуального шума. Health metrics, charts, blurred data bubbles, yellow
palette и dashboard information architecture являются anti-reference для Platform.

### Explicit anti-patterns и rejected defaults

- случайная component-library эстетика, которая делает Platform похожей на default demo;
- decorative dashboard cards вокруг каждого фрагмента content;
- generic AI gradients, glow и glass effects без product meaning;
- бессмысленная section numbering и marketing CTA rhythm внутри application shell;
- привычки LMS: forced linear path, completion theater, streaks и gamification без реальной
  learning value;
- перегруженная постоянная navigation, в которой global, Material и authoring context видимы
  одновременно;
- иллюстрация или animation как обязательный заполнитель каждого empty space;
- неподтверждённые social signals, progress и activity, создающие ложную «живость».

## 5. Working direction hypotheses

### H1 — Soft Technical Workshop

Рабочая owner preference, но не final concept.

- **Character:** спокойная светлая мастерская для инженерного чтения и работы.
- **Intended emotion:** сосредоточенность, актуальность, ощущение аккуратно собранного живого
  продукта.
- **Signature hypothesis:** один orange signal path связывает current video time, active chapter,
  reading/save state и следующий meaningful action.
- **Surfaces to prove:** Library/search, long-form/video Material и author editor/Preview на mobile
  и desktop.
- **Main risk:** превратиться в generic cream/orange AI interface или слишком буквально перенести
  ретро-иллюстрации landing.

### H2 — Living Knowledge Atlas

- **Character:** связанная карта Materials, Topics и Series, где navigation relationships заметнее
  обычного catalog grid.
- **Intended emotion:** исследование и обнаружение полезных связей.
- **Signature hypothesis:** contextual path между Material, Series, Topic и Roadmap без
  gamification.
- **Surfaces to prove:** тот же Library/search, long-form/video Material и author editor/Preview
  fixture set, но с более заметными content relationships.
- **Main risk:** перегрузить discovery и заставить reader разбираться в topology до чтения.

### H3 — Quiet Content Studio

- **Character:** максимально спокойный reader/author canvas; brand проявляется через typography,
  rhythm и точные state accents.
- **Intended emotion:** доверие и длинная концентрация.
- **Signature hypothesis:** Material плавно меняет режим между reading, video context и author
  Preview без смены visual language.
- **Surfaces to prove:** тот же Library/search, long-form/video Material и author editor/Preview
  fixture set, но с editorial canvas как dominant treatment.
- **Main risk:** потерять узнаваемый Inside character и стать generic publishing tool.

H1 задаёт текущий starting point. #22 обязан сравнить 2–3 genuinely different concepts на одном
real fixture set; варианты не могут отличаться только palette или sidebar position.

## 6. Navigation и composition остаются открытыми

Exploration session проверила три topology hypotheses: compact global rail, landing-like floating
header и denser workbench split. Owner не утверждал ни один generated comp как pixel authority.

Следующая работа должна отдельно доказать:

- нужен ли persistent desktop rail либо достаточно global header;
- как global destinations `Главная / Библиотека / Карта` адаптируются на narrow mobile;
- когда local Material context становится right rail, inline section или bottom sheet;
- как reading canvas сохраняет удобную длину строки при chapters, notes и Resources;
- какие shell transitions помогают сохранить mental context и не нарушают reduced-motion
  preference.

## 7. Alive, not animated

Живость подтверждают реальные observable facts:

- new/updated Material и active Series;
- explicit `Продолжить`, history и manual read/unread state;
- current video chapter/timecode и bounded playback progress;
- save/publish/access feedback;
- partial/loading/error states, которые не скрывают доступный content;
- purposeful transitions между card, Material и contextual panel.

Не использовать fake viewers-online, случайные pulses, auto-generated achievements, бесконечное
floating/parallax движение, progress по scroll/time heuristics или animation без
`prefers-reduced-motion` behavior.

## 8. Incremental owner-control boundary

Owner попросил реализовывать направление поэтапно, проверяя rendered результат до расширения на
следующие surfaces. Этот visual brief фиксирует только такой decision boundary; delivery и PR
rules принадлежат [repository workflow](../../WORKFLOW.md).

Owner также ожидает подходящие libraries и current best practices. Конкретную component strategy
этот brief не исследует и не выбирает: она целиком принадлежит
[ticket #23](https://github.com/sachkov-inside/platform/issues/23) после concept proof #22.

## 9. Explicitly not final

На этом этапе не зафиксированы:

- exact palette values, typefaces, icon family, radius/spacing scale и elevation tokens;
- sidebar versus header versus hybrid shell;
- generated composition screenshots;
- component/primitives library;
- final motion grammar и timings;
- comments/community UI;
- standalone Practice information architecture;
- full design system или component catalog.

## 10. Handoff

#21 даёт #22 confirmed taste constraints, anti-patterns и hypotheses. #22 возвращает explicit owner
selection на одинаковых real Library, Material и authoring surfaces. Только после этого #23
доказывает component strategy, а первый production UI ticket реализует один reference surface и
извлекает reusable pieces по фактической необходимости.
