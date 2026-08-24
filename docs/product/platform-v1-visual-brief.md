# Sachkov Inside Platform v1 — owner-taste visual input

Статус: owner-calibrated input от 2026-08-21 для
[Platform issue #21](https://github.com/sachkov-inside/platform/issues/21).

Этот документ фиксирует рабочий visual character, preference axes, annotated references,
anti-references и процесс последующей реализации. Он не является pixel-perfect specification:
конкретная композиция, palette, typeface, navigation shell, motion timing и component strategy
доказываются поэтапно на реальных responsive surfaces.

Structural UX authority остаётся в
[Platform v1 UX brief](platform-v1-ux-brief.md), а UI laboratory и production integration — в
[Platform Specification #19](https://github.com/sachkov-inside/platform/issues/19) и
[application specification](../specifications/platform-v1.md). Этот input не возвращает
standalone concept/component gates #22/#23: visual language сначала проверяется в bounded,
owner-controlled UI laboratory, затем принятые outputs — в production shell и реальных surfaces.

## 1. Subject, audience и jobs

Platform — живая инженерная мастерская и канонический дом полноценных Materials Inside, а не
линейный курс, dashboard метрик или ещё один documentation portal. Product scope и полный surface
inventory принадлежат [Platform MVP brief](platform-mvp-brief.md) и
[Platform v1 UX brief](platform-v1-ux-brief.md); здесь зафиксированы только jobs одинаковых
representative fixtures, на которых UI laboratory и production surfaces проверяют visual
decisions.

| Reference surface | Audience | Single job |
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
- Вся frontend-разработка Platform идёт mobile-first: base composition, content priority и
  interaction model сначала доказываются на narrow viewport, а tablet/desktop добавляют
  space-driven enhancements через min-width/container queries. Desktop composition не
  проектируется как primary layout с последующим сжатием для mobile.
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
| H2 против H3 | Owner не дал предпочтения и попросил не превращать approximate direction в точную final reference | Pairwise outcome — tie; оба остаются optional lenses для real surfaces, но их не нужно отдельно прототипировать |
| Exact reference против adaptable direction | Реализовывать поэтапно под owner control, не считать reference точной спецификацией | Ни один mockup/source не получает pixel authority; решения подтверждаются на rendered surfaces |

Итоговый rank для текущего handoff: `H1 > H2 = H3`. Это starting taste signal для первой
production baseline, но не final visual selection и не требование создать несколько concepts.

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
  discovery need evidence in their owning production surfaces.
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
  player, chapters and transcript behavior require owning implementation evidence.
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

H1 задаёт starting point для первого production consumer. H2/H3 остаются reasoning lenses, если
конкретный surface выявит их реальную пользу; отдельное сравнение 2–3 whole-screen concepts не
требуется.

## 6. Owner-approved UI laboratory baseline

Rendered review в [Platform #45](https://github.com/sachkov-inside/platform/issues/45) 2026-08-23
подтвердил первую bounded baseline для продолжения laboratory. Это approval конкретных patterns,
а не pixel authority для ещё не спроектированных interiors или merge GO:

- desktop использует округлый full-height sidebar: в auto-режиме он раскрывается по hover/focus,
  может быть явно закреплён, а profile utility с реальной avatar остаётся у нижней границы независимо
  от page scroll;
- collapsed sidebar показывает brand mark, а pin control появляется только в expanded state;
- mobile использует постоянную нижнюю navigation для `Главная / Библиотека / Карта`, а не burger;
- `Media Card` является принятой основой Material preview: bounded card не растягивается на всю
  страницу, video получает реальный preview с duration в одном месте, а Material без preview
  остаётся content-first без искусственной заглушки;
- card hierarchy строится из compact tags, небольшого title, короткого description, Format и
  access state; мягкая elevation отделяет card от canvas без журнальной плоскости;
- `Hybrid Catalog` является принятым composition proof для этих cards, но не финальным layout
  Библиотеки.

Текущие rendered proofs находятся в Storybook stories `Navigation/Application shell` и
`Compositions/Material cards`. Laboratory использует Tailwind CSS, shadcn-compatible shared UI
structure и Agentation как owner-feedback overlay; production routes пока не импортируют workshop
runtime или fixtures.

Rendered review 2026-08-24 принял bounded responsive proof Библиотеки как основу следующей
laboratory-итерации:

- mobile использует сплошной content canvas без внешней рамки, компактный title region,
  полноширинные Search и custom Filters, две полностью видимые Topic cards на шаг horizontal
  navigation и отдельный блок `Плейлисты`;
- desktop сохраняет ту же information architecture, использует весь viewport и прокручивает только
  main content; округлый sidebar остаётся плавающим с небольшим inset, а profile закреплён внизу;
- native browser selects не входят в visual language: workshop использует собственный accessible
  Select;
- `Плейлисты` является проверяемым UI label для ordered collections, но не переименовывает
  канонический domain term `Series` без отдельного product decision;
- production routes и backend seam по-прежнему не импортируют workshop fixtures или runtime.

Следующий отдельный owner proof — mobile-first long-form Material reader с разрешённым body state,
после него — video и closed-access states. Reader сначала проверяет реальный reading rhythm на
320×568, затем получает desktop enhancement той же information architecture. В proof нужны title и
metadata context, устойчивый reading measure, representative headings/lists/code/media/links,
local navigation, Resources, related Materials и manual read/unread state. Поведение постоянной
mobile bottom navigation во время чтения остаётся owner decision owning surface review.

Не объединять reader proof с production route, backend/client integration, video player,
closed-access acquisition flow или author editor. Stopping condition: owner может прочитать один
реалистичный длинный Material на mobile и desktop, проверить typography, local navigation и конец
reading flow и явно принять либо скорректировать composition.

Chapters, video timecode, closed access и authoring composition остаются открытыми до своих owning
surface reviews.

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

Owner также ожидает подходящие libraries и current best practices. UI laboratory проверяет
bounded reference compositions и component sources через rendered owner review; принятые visual
решения затем расширяются только из needs реального surface. Exact tool, dependencies, typed
interfaces, production adoption и external-service gates принадлежат application specification и
repository workflow.

Mobile-first здесь является implementation constraint, а не отдельной mobile-версией:
information architecture и core actions остаются одними на всех viewport, touch targets нельзя
завязывать на hover, а responsive breakpoints вводятся там, где ломается content, а не по
списку моделей устройств.

## 9. Explicitly not final

На этом этапе не зафиксированы:

- exact palette values, typefaces, icon family, radius/spacing scale и elevation tokens;
- production Library/search, Material reader и author editor/Preview compositions;
- contextual navigation внутри Material и authoring surfaces;
- generated composition screenshots;
- component/primitives library;
- final motion grammar и timings;
- comments/community UI;
- standalone Practice information architecture;
- full design system или component catalog.

## 10. Handoff

#21 передаёт confirmed taste constraints, anti-patterns и hypotheses в UI laboratory и owning
production surfaces. Каждый stage показывает owner rendered mobile/desktop evidence до расширения
visual direction. Exact ticket graph и integration boundaries принадлежат application
specification; отменённые concept/component gates #22/#23 и superseded shell-only design ticket
#40 остаются provenance, а не альтернативной delivery model.
