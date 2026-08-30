---
version: 1
slug: "route-account"
primary_target: "route:/account"
related_targets: ["route:/members/[publicProfileId]", "apps/web/app/layout.tsx"]
---

# Account and Member Profile

Mode: Operate. A signed-in Account owner completes first-entry naming, edits or removes Profile data, exports it, and can verify the exact projection an active member receives. An active member reads that projection and may report unsafe text.

Temporary direction: **Two sides of profile**, selected by delegated fallback after both decision channels returned no answer. It is not owner-approved. Decision comp: `.impeccable/mocks/decision/mirror-seam.png`.

Finish verdict: `ship`; `material_fixes: []`. Production desktop/mobile evidence lives in
`docs/evidence/issue-51/`. Owner production visual GO is still pending, so Mirror seam is a
candidate pattern backed by evidence, not a globally approved mandate. Asset production returned
`produce: []` and `direct: []`; no raster ships.
Owner visual acceptance and removal of the temporary #51 interface marker are tracked in #155.

The memorable moment is one literal privacy seam: `Только вы` and `Видят участники`. Desktop keeps editor and exact preview beside it; narrow screens preserve the same truth as edit → preview → lifecycle actions. Onboarding is a focused modal over the current application surface and asks only `Как к вам обращаться?`.

Do not literalize generated copy errors, fixed pixel widths, or the orange-filled primary button: implementation uses canonical charcoal primary controls and semantic responsive code. No avatar, upload, email, Membership/Telegram state, internal identifier, directory or search enters this surface.

## Comp inventory

| Ingredient | Commitment | Medium |
|---|---|---|
| Existing sidebar and mobile dock | Reuse accepted navigation and account utility | Existing production module |
| Account title | Restrained display heading, no marketing hero | Semantic HTML/CSS |
| Privacy seam | One fine vertical rule with a scarce orange-outlined label and literal two-sided sans context; becomes a sequence on mobile | Semantic HTML/CSS |
| Owner editor | Name, bio, optimistic save/conflict state and dirty-only primary Save | Semantic form controls |
| Member projection | Same accepted display name/bio in a flat 16px frame with no glow, plus opaque copy-link action only | Semantic HTML/CSS + Lucide icon |
| Lifecycle | Export and delete below the main editing task | Semantic links/buttons |
| Generated raster | Decision evidence only; never ships in runtime UI | `.impeccable` comp |

Unresolved product decisions: none for #51. Avatar/S3 remains #153; Telegram/Membership Account presentation remains #122.
