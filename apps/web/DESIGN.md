---
name: Sachkov Inside Platform
description: Soft Technical Workshop for focused engineering reading and exact-state authoring.
colors:
  background: "oklch(0.965 0.008 112)"
  foreground: "oklch(0.205 0.014 129)"
  card: "oklch(0.99 0.004 112)"
  popover: "oklch(0.995 0.003 112)"
  primary: "oklch(0.29 0.018 132)"
  primary-foreground: "oklch(0.985 0.004 112)"
  secondary: "oklch(0.93 0.012 117)"
  muted: "oklch(0.925 0.01 115)"
  muted-foreground: "oklch(0.49 0.018 128)"
  accent: "oklch(0.66 0.19 39)"
  accent-foreground: "oklch(0.995 0.003 112)"
  destructive: "oklch(0.5 0.2 27)"
  border: "oklch(0.86 0.015 118)"
  input: "oklch(0.86 0.015 118)"
  ring: "oklch(0.62 0.17 39)"
  sidebar: "oklch(0.27 0.014 128)"
  sidebar-foreground: "oklch(0.94 0.008 112)"
  sidebar-accent: "oklch(0.34 0.015 128)"
  sidebar-primary: "oklch(0.68 0.19 40)"
typography:
  display:
    fontFamily: "Manrope Variable, ui-sans-serif, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Manrope Variable, ui-sans-serif, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Manrope Variable, ui-sans-serif, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Manrope Variable, ui-sans-serif, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "Manrope Variable, ui-sans-serif, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
  technical:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0.56875rem"
  md: "0.7175rem"
  lg: "0.875rem"
  xl: "1.18125rem"
  2xl: "1.4875rem"
  3xl: "1.8375rem"
  pill: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 0.625rem"
    height: "2rem"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 0.625rem"
    height: "2rem"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 0.625rem"
    height: "2rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 0.625rem"
    height: "2rem"
  select-trigger:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "0 0.75rem"
    height: "2.75rem"
  material-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "1rem"
    width: "min(100%, 24rem)"
---

# Design System: Sachkov Inside Platform

## Overview

**Creative North Star: "Soft Technical Workshop"**

Sachkov Inside Platform — спокойная светлая инженерная мастерская: тёплый canvas оставляет место контенту, charcoal-регионы собирают code, media и focused work, а orange появляется только там, где нужно доказать current state или следующий meaningful action. Интерфейс современный и мягко округлённый, но остаётся операционным: grouping, hierarchy и exact product facts важнее декоративной плотности.

Это документированная incumbent world, выросшая из owner-calibrated H1 и уже реализованных foundations и reusable primitives. Она не делает каждую поверхность карточкой, не переносит marketing composition в приложение и не выдаёт task-specific proof за глобальный system mandate. issue #38 завершил finish review со статусом `ship`; exact Preview теперь имеет bounded desktop и narrow-mobile evidence, но authoring layout и revision rail остаются candidate pattern до отдельного owner visual/interaction GO.

**Key Characteristics:**

- Warm light canvas with bounded charcoal work regions.
- Scarce orange proofing signal rather than ambient decoration.
- Rounded controls and containers with explicit grouping purpose.
- Manrope for product and reading; JetBrains Mono only for technical facts.
- Mobile-first semantic order preserved as space adds columns.
- Exact revision, validation, save and publication facts stay visible and literal.

## Colors

Палитра строится на тёплых near-paper neutrals, charcoal ink/workbench regions и одном редком orange signal. Light is the application default; dark values exist in the token source for controlled theme rendering, but the accepted H1 direction does not make a dark application shell the default.

### Primary

- **Workshop Charcoal** (`primary`): главный action color и плотный text-on-light control; используется для единственного primary action в локальной задаче.
- **Proof Orange** (`accent`): current state, focus-adjacent evidence, active navigation detail, markers and meaningful links. It is not a generic fill.

### Secondary

- **Warm Utility Wash** (`secondary`): спокойное tonal grouping для selected, callout, chip и safe secondary context.

### Neutral

- **Warm Workshop Canvas** (`background`): основной light canvas.
- **Chalk Card** (`card`) и **Popover Paper** (`popover`): читаемые приподнятые или bounded surfaces.
- **Charcoal Ink** (`foreground`) и **Quiet Technical Ink** (`muted-foreground`): основной и вторичный текст.
- **Soft Workbench Divider** (`border`, `input`): структура через тонкие линии без card-everywhere.
- **Bounded Workbench** (`sidebar`) с **Workbench Chalk** (`sidebar-foreground`): code, media, navigation и другие сфокусированные dark regions.
- **Destructive Red** (`destructive`): validation, authorization, conflict and infrastructure failure only.

**The Orange Proof Signal Rule.** Orange marks current state, focus or a meaningful product accent; if it does not help the user verify or act, do not use it.

## Typography

**Display Font:** Manrope Variable (with `ui-sans-serif, sans-serif` fallback)

**Body Font:** Manrope Variable (with `ui-sans-serif, sans-serif` fallback)

**Label/Mono Font:** JetBrains Mono Variable (with `ui-monospace, monospace` fallback)

**Character:** Manrope keeps application copy calm and readable while its compact semibold headings provide a clear scan hierarchy. JetBrains Mono is deliberately smaller and quieter so revision IDs, timestamps, duration and state facts read as evidence, not as a second visual voice.

### Hierarchy

- **Display:** restrained page or exact-preview title, never marketing-hero scale inside the application.
- **Headline:** section and reading headings with tight negative tracking.
- **Title:** compact card, panel and authoring titles.
- **Body:** product copy and long-form reading; long reading regions stay near 65–72 characters.
- **Label:** controls and field labels with medium weight rather than all-caps urgency.
- **Technical:** revision IDs, state facts, timestamps, duration, metadata and code-adjacent notation.

**The Mono Is Evidence Rule.** Use JetBrains Mono only for revision/state facts, code, duration, technical notation and compact metadata; never use it as decorative body copy.

## Layout

The system is mobile-first. Narrow surfaces preserve content priority and a single semantic reading order, then add space-driven enhancements through min-width or container queries. The accepted application shell uses a continuous mobile canvas with a persistent compact bottom navigation; desktop adds the inset expandable charcoal sidebar and lets the main content own scrolling. Reading columns remain bounded near 70–72 characters, while application canvases use generous maximum widths appropriate to the task.

The issue #38 authoring proof keeps metadata → document → validation in that order on narrow screens and expresses the same order as three desktop columns inside a wide workbench. Exact Preview now has desktop and 390 × 844 mobile evidence with the same exact-revision identity and no horizontal overflow. The sticky author header and orange revision rail remain a candidate authoring pattern pending owner visual/interaction GO, not a required layout for other operate surfaces.

**The Mobile Semantic Order Rule.** Responsive changes may add columns, rails or contextual controls, but they must preserve the narrow-screen information order and primary actions.

## Elevation & Depth

The system is mostly tonal and bordered. Resting content surfaces use canvas, card, muted fill and one-pixel dividers; restrained card shadows are reserved for interactive bounded objects such as accepted Material cards and popover content. Charcoal regions create structural depth without glow, glass or gradients. Hover lift is slight and disabled for reduced-motion users; Storybook exercises that contract in a real reduced-motion browser context.

### Shadow Vocabulary

- **Card:** `--elevation-card` separates an interactive bounded card from the warm canvas.
- **Card Hover:** `--elevation-card-hover` pairs with a half-step lift to acknowledge pointer intent.

**The Flat-by-Default Rule.** Keep reading and authoring surfaces flat at rest; use elevation only when it communicates an interactive bounded object or overlay.

## Shapes

Soft rounding is a grouping grammar, not decoration. Compact actions and navigation use the shared small-to-large radius scale; fields, popovers, callouts and Material cards use the larger rounded surface step; access labels may use a pill. Large application-shell silhouettes use the extra-large radius steps. Thin semantic borders and clipped dark media/code regions keep the softness technical rather than toy-like.

## Components

### Buttons

- **Shape:** compact rounded action primitive with eight size variants and minimum touch-aware compositions where the surrounding pattern requires them.
- **Primary:** charcoal fill for the single highest-priority action in a local task. In authoring, Save is primary only while dirty; disabled Save remains visible without competing.
- **Outline / Secondary / Ghost:** outline preserves a clear alternative, secondary marks safe selected context, and ghost recedes for navigation or toolbar actions.
- **Hover / Focus:** restrained tonal change, a visible semantic ring, one-pixel active translation, and no transform under reduced motion.

### Select

- **Style:** an accessible Radix-backed custom select, not a native browser select; rounded trigger, border, warm background and compact chevron.
- **State:** muted hover/open fill, semantic focus ring, checked item with secondary fill and orange check indicator, disabled value preserved.
- **Overlay:** rounded popover with restrained card elevation and reduced-motion-safe entry/exit.

### Tooltip

- **Style:** compact charcoal explanation with inverse text and a small pointer.
- **Behavior:** non-essential help only, available from pointer hover and keyboard focus; motion is removed under reduced-motion preferences.

### Application Shell and Navigation

- **Desktop:** accepted inset full-height charcoal sidebar, collapsed by default, expanded by hover/focus or explicit pin; current location uses a restrained orange signal.
- **Mobile:** accepted persistent three-item bottom navigation with safe-area padding and touch targets at least 44px high.
- **Content:** reading/work surfaces remain visually dominant and global navigation never crowds local context.

### Material Card

- **Style:** accepted bounded Material preview with optional real `16:9` media, compact taxonomy, short title/summary, exact format/access facts and restrained elevation.
- **Behavior:** no artificial media placeholder; a Material without preview remains content-first and naturally shorter.

### Candidate Authoring Workbench

- **Status:** candidate pattern from issue #38; finish verdict is `ship`, but global adoption awaits owner visual/interaction GO.
- **Composition:** sticky author header, revision rail, and metadata → document → validation semantic order; desktop may render the order as three columns.
- **State:** exact revision, save and validation facts remain literal; Preview names the exact immutable revision, never adds unowned transport/security claims, never implies publication and now has desktop plus narrow-mobile proof.

**The Owner Gate Candidate Rule.** Treat the issue #38 authoring layout and revision rail as reusable evidence to review, not as an approved global mandate, until owner visual/interaction GO is recorded.

## Do's and Don'ts

### Do:

- **Do** keep the warm light canvas dominant and bound charcoal to navigation, code, media or focused work regions.
- **Do** reserve orange for current state, validation/focus evidence and the next meaningful action.
- **Do** use Manrope for product copy and JetBrains Mono for exact technical facts.
- **Do** preserve the same semantic information order from narrow mobile to desktop.
- **Do** expose save, validation, conflict, authorization and exact-revision truth with text as well as color.
- **Do** use the accepted shared primitives and Storybook proofs before introducing a new visual dialect.

### Don't:

- **Don't** turn reading or authoring into a generic dashboard of decorative cards.
- **Don't** use gradients, glow, glass or ambient animation without product meaning.
- **Don't** make orange a default decoration or destructive red a brand accent.
- **Don't** use JetBrains Mono for long-form prose or ornamental headings.
- **Don't** promote the issue #38 authoring columns or revision rail to a global pattern before owner visual/interaction GO.
- **Don't** imply that Preview is latest or published; always identify the exact immutable revision.
