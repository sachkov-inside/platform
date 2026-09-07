# Guest Home prototype #380

Question: how can the current Platform Home explain Inside to a guest while keeping series and
materials directly explorable?

- A: short introduction followed by material cards.
- B: pinned series with Kirill's existing 2D avatar, topic filters and a compact access invitation.
- C: author introduction, an example series and the role of discussion/community.

All copy, series contents, access labels and article bodies are samples for composition review.
They do not establish publication status, commercial terms or a personal support commitment.
The membership screen is a local demonstration without checkout. No variant is accepted yet.

Run from the Platform root: `pnpm storybook`. Look under **Pages / Guest Home / Prototype 380**.
Named stories open each composition; the switcher shares `?variant=A`, `B`, or `C` in the preview
URL. On mobile the comparison control is above the page, so it does not cover product navigation.
Series/material links and access buttons use in-memory sample screens. Reload returns to Home.
Agentation remains enabled for owner feedback.

The prototype lives only in the Storybook graph and on `prototype/380-guest-home-variants`.
It is not a production implementation or a branch intended for merge.
Issue: https://github.com/sachkov-inside/platform/issues/380

## Avatar provenance

`kirill-explaining.png` is an unmodified copy of the owner-requested asset from
`KirillSachkov/vertical-content`, component `production`, path
`public/assets/presenter/poses/explaining.png`. The source pose and identity are documented in
`production/assets/presenter/POSES.md` and `REFERENCE.md`. No new image generation was used.
The source repository remains unchanged. CSS supplies cropping and a one-shot entrance, disabled
for `prefers-reduced-motion: reduce`.

## Verification

- Root `pnpm check`: passed (including docs, lint, types, architecture, module/route tests,
  production build and Storybook build).
- `pnpm test:storybook`: 32 files, 274 tests passed.
- Browser review: all three compositions at 1440 and 320 px; banner also checked at 390 px.
  No document horizontal overflow at 320/390 px. Topic filtering and the series → material →
  membership path checked interactively. Heading focus moves to the newly opened sample screen.
- Not tested: production, real materials/access policy, checkout, conversion and real user response.
