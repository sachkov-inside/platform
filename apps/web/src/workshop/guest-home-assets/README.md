# Guest Home prototype #380

## Current owner decision

On 8 September 2026 the owner selected the avatar presenting a miniature application
(`kirill-mini-app.png`). Variant B with this pose is now the default, including mobile and
text-preference stories. The calm portrait remains an alternative. This confirms the avatar
choice for the prototype; production integration and domain migration remain separate work.
The final review story is **Главная · Итог** (`pages-guest-home-prototype-380--final-home`),
without the comparison toolbar. Content and header share a centered container: at standard root
size its useful width stops at 1216 px; Full HD/QHD/4K add empty side margins. Body stays 16/24;
section headings are 18/24 mobile and 24/30 desktop, with weight 600. The selected miniature-app
artwork and production Home section order remain intact.
[Responsive research and evidence](../../../../../docs/research/issue-380-responsive-home.md)
records the tokens, viewport matrix, text preferences and limitations.

The refinement notes below preserve the exploration history.

Question: how can the current Platform Home explain Inside to a guest while keeping series and
materials directly explorable?

- A: short introduction followed by material cards.
- B: pinned series with Kirill's edited 2D avatar, followed by the current Home sections and a compact access invitation before new videos.
- C: author introduction, an example series and the role of discussion/community.

All copy, series contents, access labels and article bodies are samples for composition review.
They do not establish publication status, commercial terms or a personal support commitment.
Series, topic, catalog, reader, locked access and sign-in screens import the current production
components from main (base `55237eb1`; Home and shell verified unchanged through `09290bf7`). Fixture adapters supply their presentation data; no checkout
or real sign-in is performed. The miniature-app avatar is selected; production integration is still separate.

Run from the Platform root: `pnpm storybook`. Look under **Pages / Guest Home / Prototype 380**.
Named stories open each composition; the switcher shares `?variant=A`, `B`, or `C` in the preview
URL. On mobile the comparison control is above the page, so it does not cover product navigation.
Series/material links preserve the production `from` return target and series previous/next navigation.
The local scene switcher renders production pages with fixtures. Reload returns to Home.
Agentation remains enabled for owner feedback.

The prototype lives only in the Storybook graph and on `prototype/380-guest-home-variants`.
It is not a production implementation or a branch intended for merge.
Issue: https://github.com/sachkov-inside/platform/issues/380

## Avatar provenance

The original `kirill-explaining.png` is preserved from `KirillSachkov/vertical-content`,
`production/public/assets/presenter/poses/explaining.png`. The source repository is unchanged.

Three new pose edits use that illustration as the identity reference:
- [Calm portrait](kirill-portrait.png)
- [Lower explanatory gesture](kirill-gesture.png)
- [Floating 3D modules](kirill-object.png)

Generated with built-in image_gen. [Exact prompts](avatar-variants-prompts.md) are saved alongside
these assets. The owner authorized local image processing; ImageMagick removed the generated
background and softened cutout edges. All three final files have a genuine alpha channel.
The earlier raised-hand attempt is retained as `kirill-raised-hand.png` for provenance.

The main B story now defaults to the compact outward explanatory gesture (`kirill-gesture-compact.png`).
The previous gesture and intermediate outward edit are preserved.
[Exact refinement prompts](compact-outward-prompts.md) record the built-in image edits and alpha cleanup. B1/B2/B3 and the pose selector retain
portrait/gesture/object for comparison. The mobile banner has a 176 px minimum height and grows
with enlarged text. Its CTA is on the right over the avatar. The torso fade is slightly stronger.
The desktop practice badge remains at bottom right for portrait/gesture; the object version omits it.
Code, Git branch and terminal icons repeatedly drift from the gesture avatar's shoulder.
Each six-second cycle includes a quiet interval. Reduced motion hides them. There are no playback controls.
The owner explicitly requested recurring motion after reviewing the one-shot version.

The candidate mobile type scale uses Manrope: page 24/30, section/banner 18/24, card 16/22,
body 16/24, UI 14/20 and metadata 12/16. Headings use 600, body 400. See the
[research and source links](../../../../../docs/research/issue-380-mobile-typography.md).
Dedicated stories show the scale, text at 200% and user text-spacing overrides. The workshop's
candidate dock shows only icons across all mobile shell widths; the link names remain available
to screen readers. HomePage has one optional `beforeVideos` presentation slot for the invitation.
Its default rendering and all live adapters remain unchanged. B uses HomePage directly, retaining
series → topics → new videos → fresh guides → notes → catalog. New fixture videos/notes also
participate in catalog filtering and reader navigation; video samples show membership access.

## Verification

- All root `pnpm check` stages passed. The refinement run reached the build and caught an invalid
  Storybook matcher option; after correction, lint, types, builds and standalone-config checks
  were rerun successfully. Module tests: 420 backend and 488 web passed; route tests: 43 passed.
- Initial full `pnpm test:storybook`: 32 files, 274 tests passed. After refinement, all seven guest
  stories passed, including the new production-page navigation scenario.
- Browser review: all three compositions at 1440 and 320 px; banner also checked at 390 px.
  Refinement also checked at 768 px. No document horizontal overflow at 320/390 px. Topic filtering and the series → material →
  access/sign-in path checked interactively. The B story checks production series/locked-reader
markers, next material and return to Home. Heading focus moves to the newly opened sample screen.
- Not tested: production, real materials/access policy, checkout, conversion and real user response.

Latest pose refinement: typecheck, focused lint and seven Storybook stories passed. Visual checks cover 320/390 px and desktop; source background removal was inspected against the dark banner.

Latest typography/shoulder refinement: typecheck and focused lint passed; the full Storybook suite
passed 32 files / 280 tests. After final reflow adjustments, all ten guest stories passed again,
and Storybook built successfully. Browser checks cover 320/390/430 px and desktop, including
320 px text at 200% and increased text spacing. These are local browser checks, not native-device
or complete accessibility certification.

8 September compact gesture/main composition refinement: root `pnpm check` passed (420 backend
module tests; 494 web tests passed / 1 skipped; 43 route tests; types, lint, guardrails and builds).
Full Storybook: 32 files / 280 tests passed. The final heading-wrap adjustment was also checked
in the ten guest stories. Browser inspection: 320/390 px, 320 px text at 200%, and desktop.
The palm remains visible above the CTA at 320 px; icon-only dock is 170 px wide; document width
is 320 px at enlarged text. Standards and Spec reviews passed for the refinement.

Latest owner direction: the explanatory gesture is removed from the pose selector and stories.
The calm portrait is now the default; the floating-object variant remains for refinement. Previous
gesture assets stay archived for provenance. Development glyphs emit one at a time at one-second
intervals (three staggered three-second loops) on both remaining poses, with reduced motion retained.
The proposed desktop lowering/shoulder edit was cancelled before implementation when the owner
rejected the gesture. Object concepts are being discussed before another image generation.

Miniature application candidate: B2 now uses `kirill-mini-app.png`, a built-in image_gen edit of
the cube pose. The floating window uses a large orange panel and two neutral content cards.
[Prompts and alpha cleanup](mini-app-prompt.md) preserve the exact generation record. The calm
portrait remains the default and the original cubes remain archived. On mobile only, this pose
is lifted 12 px and the CTA bottom padding reduced by 8 px so the full window stays above it.
Reviewed at 320/390 px and desktop; no horizontal overflow at 320 px. Nine guest stories and
the Storybook build passed. This remains a local visual candidate with fixture content.

Latest composition adjustment: the subscription strip sits after topics and immediately before
new videos. The guest prototype disables the redundant catalog invitation through
`showCatalogInvitation={false}`; existing production calls keep their default catalog invitation.
The ordered-section story checks the invitation's location and absence of the catalog section.
Focused Home/guest stories: 12 passed; types and lint passed. Mobile preview checked at 390 px.
Domain migration is recorded separately in Workspace #146; this refinement makes no domain changes.

Verification for the invitation move: all root check stages passed across the initial run and
targeted retry. The first route-test server hit macOS EMFILE; rerunning with
`WATCHPACK_POLLING=1000 PLAYWRIGHT_PORT=3118` passed all 43 route tests, followed by application
builds, standalone-config checks and the Storybook build. Standards and Spec reviews had no findings.
