# Guest Home prototype #380

Question: how can the current Platform Home explain Inside to a guest while keeping series and
materials directly explorable?

- A: short introduction followed by material cards.
- B: pinned series with Kirill's existing 2D avatar, topic filters and a compact access invitation.
- C: author introduction, an example series and the role of discussion/community.

All copy, series contents, access labels and article bodies are samples for composition review.
They do not establish publication status, commercial terms or a personal support commitment.
Series, topic, catalog, reader, locked access and sign-in screens import the current production
components from main (base `55237eb1`). Fixture adapters supply their presentation data; no checkout
or real sign-in is performed. No variant is accepted yet.

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

The main B story now defaults to the explanatory gesture. B1/B2/B3 and the pose selector retain
portrait/gesture/object for comparison. The mobile banner has a 176 px minimum height and grows
with enlarged text. Its CTA is on the right over the avatar. The torso fade is slightly stronger.
The desktop practice badge remains at bottom right for portrait/gesture; the object version omits it.
Code, Git branch and terminal icons drift from the gesture avatar's shoulder and disappear within
4.6 seconds. Reduced motion hides them. There are no playback controls.

The candidate mobile type scale uses Manrope: page 24/30, section/banner 18/24, card 16/22,
body 16/24, UI 14/20 and metadata 12/16. Headings use 600, body 400. See the
[research and source links](../../../../../docs/research/issue-380-mobile-typography.md).
Dedicated stories show the scale, text at 200% and user text-spacing overrides. The workshop's
candidate dock spacing keeps navigation readable when text grows without changing production files.

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
