# Mobile-first design resources for Platform

Status: research note, 2026-09-03. This is input for the throwaway mobile-first Storybook
prototype, not a dependency or visual-system decision.

## Question

Which resources from the Pronin Learn reference list can help Platform prove a mobile-first
Library, Topics, Material reader, covers, floating navigation and purposeful motion without adding
a second component system or copying another product's identity?

## Current boundary

Platform already uses React 19, Next.js 16, Tailwind CSS 4, local shadcn-style components, Radix,
Lucide and Storybook. Production and Storybook share the same tokens. A new design-system package
must therefore solve a missing interaction, not just offer another default look.

## Recommendation

Use the sources in four different roles:

1. Keep **Storybook + current shadcn/Radix primitives** as the implementation and review base.
2. Use **tweakcn** only as a token exploration tool.
3. Trial **3dicons** for a small set of cover directions and **Morphicons** for one navigation
   transition after the static hierarchy is accepted.
4. Treat **Mobbin, recent.design, posts.design, Refero, Dprofile and similar galleries** as research
   indexes. Record the exact original product or asset behind any accepted reference.

Do not install HeroUI, Appica UI or a large 21st.dev selection alongside the current primitives.
That would create competing component APIs and visual defaults before the mobile hierarchy is
settled.

## Implement or trial

### Storybook

The official documentation defines Storybook as a workshop for components and pages in isolation,
including hard-to-reach states. It also provides viewport and accessibility testing facilities.
This is exactly the existing Platform review path, so no new tool is needed.

- Use now: mobile 320/390 and desktop viewports, interactive prototype states and owner annotations.
- Apply to: shell/navigation, Library, Topics and Material reader.
- Sources: [Storybook overview](https://storybook.js.org/docs),
  [viewport](https://storybook.js.org/docs/essentials/viewport),
  [accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing).

### shadcn/ui and existing Radix primitives

shadcn/ui describes itself as open component code and a distribution mechanism rather than a
traditional installed component library. Its intended customization model matches the repository's
current local primitives. The upstream code is MIT-licensed.

- Use now: retain current Button, Select, Tooltip and shell primitives; reshape them through local
  composition and tokens.
- Do not use defaults as visual authority.
- Sources: [shadcn/ui introduction](https://ui.shadcn.com/docs),
  [MIT license](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md).

### tweakcn

tweakcn is an Apache-2.0 visual theme editor for Tailwind and shadcn/ui. Its stated purpose is to
change color, radius, type and other theme choices without replacing the component model.

- Trial now as a comparison surface for warm canvas, charcoal, orange signal, radii and elevation.
- Bring back reviewed token values, not generated page layouts or another runtime package.
- Source: [official repository and license](https://github.com/jnsahaj/tweakcn).

### 3dicons

The official site currently separates open-source and premium work. It says the current open-source
version is CC0 and lists more than 1,400 renders across 200 icons, including notebook, folder,
shield, tools and play concepts.

- Trial now: two or three representative Library covers in Storybook, using only assets explicitly
  belonging to the CC0 set.
- Useful for testing whether authored cover art materially improves scanning on mobile.
- Do not require a 3D icon on every Material. Covers must also support diagrams, screenshots,
  frames from video and text-led art.
- Preserve the asset and license provenance in the repository if an icon is accepted.
- Source: [3dicons official site and license statement](https://3dicons.co/).

### Morphicons

Morphicons provides React bindings for morphing stroke-based icons, accepts Lucide icon data, has
no runtime dependencies in its core, supports SSR and is MIT-licensed. Its current changelog says
the reduced-motion policy must be set explicitly to `"user"` when the application wants to honor
the operating-system preference.

- Trial later on exactly one interaction: the active item or back/close transition in mobile
  navigation.
- Keep state and accessible labels in Platform; animation remains a presentation detail.
- Do not animate every icon or use morphing to hide a navigation-state change.
- Sources: [official repository](https://github.com/guillermolg00/morphicons),
  [MIT license](https://github.com/guillermolg00/morphicons/blob/main/LICENSE),
  [changelog](https://github.com/guillermolg00/morphicons/blob/main/CHANGELOG.md).

## Use as reference, not as a dependency

### HeroUI

HeroUI v3 is aligned technically with React 19 and Tailwind 4, and its React components are built on
React Aria. The repository is Apache-2.0. Those strengths overlap with the accessibility and
composition responsibilities already owned by Platform's shadcn/Radix layer.

- Reference useful compound-component APIs and documentation quality.
- Do not install it for the redesign unless a later spike names a missing primitive and compares
  migration cost explicitly.
- Sources: [official repository](https://github.com/heroui-inc/heroui),
  [v3 license](https://github.com/heroui-inc/heroui/blob/v3/LICENSE).

### 21st.dev

21st.dev is a registry of React/Tailwind components and themes rather than one coherent component
library. Its own documentation says entries come from many authors and can be installed through
the shadcn registry format. Marketplace terms also distinguish an individual component's license
from the site's demo, preview and media rights.

- Use to locate an interaction pattern, then inspect the exact component, author, dependency graph
  and license before copying anything.
- Do not paste broad generated screens into production or treat marketplace screenshots as reusable
  assets.
- Sources: [official overview](https://docs.21st.dev/),
  [documentation](https://help.21st.dev/),
  [marketplace terms](https://21st.dev/terms).

### Iconify, Solar Icons and other icon catalogs

Iconify indexes open-source icon sets but explicitly shows a separate license per set. For example,
its current catalog lists Solar under CC BY 4.0 and Lucide/Tabler-style alternatives under their
own licenses.

- Keep Lucide for the prototype and normal interface controls.
- Use Iconify only to discover a missing semantic icon, recording the selected set's license and
  avoiding mixed visual weights in one navigation system.
- Source: [Iconify icon-set catalog](https://icon-sets.iconify.design/).

### Fontshare and Google Fonts

Fontshare offers both SIL OFL fonts and proprietary freeware under its own FFL. The two categories
have different redistribution and modification rules, so “free” is not a sufficient adoption
decision.

- Keep Manrope and JetBrains Mono during hierarchy experiments so typography does not become a
  second variable.
- If type becomes the next explicit design question, compare only families with verified Cyrillic
  coverage and prefer SIL OFL assets for simple self-hosting provenance.
- Sources: [Fontshare license overview](https://fontshare.com/licenses/sil-ofl),
  [ITF FFL terms](https://www.fontshare.com/licenses/itf-ffl),
  [Google Fonts](https://fonts.google.com/).

### Reference indexes

- [Mobbin](https://mobbin.com/) is useful for searching real mobile/web screens, UI elements and
  flows. Use it to compare Library browsing, bottom navigation, profile and reader patterns across
  multiple products.
- [recent.design](https://recent.design/) indexes web, interface, branding, typography, motion,
  illustration and 3D work.
- [posts.design](https://posts.design/) indexes shipped social posts and links each entry to an
  original source. It is more relevant to Material cover language than to application navigation.
- [Refero](https://refero.design/), [Dprofile](https://dprofile.ru/),
  [inspora.design](https://inspora.design/) and [Baza Uprock](https://baza.uprock.ru/) can supply
  visual leads, but an accepted decision should cite the original work rather than the aggregator.

These are discovery tools, not licenses to reuse screenshots, motion files, artwork or code.

## Deferred pending a concrete need

Appica UI, Sigma Studio, Koboyo and Bloub were not needed to answer the current hierarchy question.
Their exact asset/component licenses and production fit must be checked from their original terms
before any code or media is imported. In particular, a paid design system or mascot generator would
change the product's visual identity rather than merely improve mobile usability.

## Concrete next steps

1. Review the three code-native Storybook variants without adding dependencies.
2. Pick the winning information hierarchy and navigation behavior.
3. Replace two prototype covers with verified CC0 3dicons assets and compare them with Inside's
   technical diagram covers.
4. Only after the navigation is accepted, spike Morphicons on one state transition with
   `reducedMotion="user"` and compare it with a static icon swap.
5. Promote accepted composition into production components; keep reference galleries and unused
   component systems out of the runtime dependency graph.
