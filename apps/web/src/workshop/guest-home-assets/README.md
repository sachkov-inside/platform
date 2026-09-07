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

`kirill-explaining.png` is an unmodified copy of the owner-requested asset from
`KirillSachkov/vertical-content`, component `production`, path
`public/assets/presenter/poses/explaining.png`. The source pose and identity are documented in
`production/assets/presenter/POSES.md` and `REFERENCE.md`. No new image generation was used.
The source repository remains unchanged. CSS crops/fades the torso with the head extending above the 224 px mobile banner. The desktop
label sits just above the palm. Code, Git-branch and terminal icons float from the avatar and fade;
`prefers-reduced-motion: reduce` hides the animation. Playback controls are omitted at the owner’s request.

## Verification

- All root `pnpm check` stages passed. The refinement run reached the build and caught an invalid
  Storybook matcher option; after correction, lint, types, builds and standalone-config checks
  were rerun successfully. Module tests: 420 backend and 488 web passed; route tests: 43 passed.
- Initial full `pnpm test:storybook`: 32 files, 274 tests passed. After refinement, all four guest
  stories passed, including the new production-page navigation scenario.
- Browser review: all three compositions at 1440 and 320 px; banner also checked at 390 px.
  Refinement also checked at 768 px. No document horizontal overflow at 320/390 px. Topic filtering and the series → material →
  access/sign-in path checked interactively. The B story checks production series/locked-reader
markers, next material and return to Home. Heading focus moves to the newly opened sample screen.
- Not tested: production, real materials/access policy, checkout, conversion and real user response.
