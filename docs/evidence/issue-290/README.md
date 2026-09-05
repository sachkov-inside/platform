# Prototype #290: Home hub, series and materials

Status: revised after owner feedback on 2026-09-05; awaiting visual review.
No production adoption or visual acceptance is implied.

Input: [Platform #290](https://github.com/sachkov-inside/platform/issues/290) and the
[accepted Workspace #112 brief](https://github.com/sachkov-inside/workspace/blob/b534239889ffabd774e220e7d91b9d13f755c800/product/content-series-authoring-brief.md).
Fixed review base: `188f92ae3bc674ca43a2f4aabbcc454ac22addbf`.
Fetched `origin/main` at `b99a6e3`; its Home implementation is unchanged from that base.

## Owner correction

The owner rejected the first landing-like A/B compositions. Home must preserve the concept
already delivered in main: a useful navigation and discovery hub that also makes Membership
value visible through its content. Topics, new videos, playlists, guides and notes must coexist.
Two featured series alone do not fulfill that purpose. This correction supersedes the earlier
proposal to replace the format sections with a marketing-first Home.

A now extends that hub. B renders the actual production `HomePage` composition on the same
sample set, as a reference rather than another proposed direction. The original production
`Illustrated Catalog` story remains available unchanged. Previous rejected compositions are
preserved in branch history through `5687b12`, not offered for selection.

## Review surface

Run `pnpm storybook` or the repository's Storybook Compose profile. The catalog entry is
`Pages / Inside showcase 290`. Only this prototype is explicitly added alongside the production
catalog; earlier proofs remain excluded. Existing story IDs stay stable for previously shared URLs.

- A, revised hub: `/iframe.html?id=pages-inside-showcase-290--value-first&viewMode=story`
- B, main composition: `/iframe.html?id=pages-inside-showcase-290--series-first&viewMode=story`
- Original main fixture: `/iframe.html?id=pages-mobile-first-platform-home--illustrated-catalog&viewMode=story`

The floating control compares A/B. URL state preserves variant, screen, Membership preview,
episode, reading-series context and catalog filters. Search text is temporary component state
and resets after leaving the catalog. Browser back/forward is supported. The expandable
`Прототип #290` panel below the page switches visitor/member presentation. Agentation is enabled.

## What changed

- Reuse production `ApplicationShell`, `PublicProductHeader`, `TopicCard`, `PlaylistCard`,
  `MaterialCard` and `PublicSectionHeading`, with the accepted tokens and artwork.
- Keep topics, new videos, fresh guides and the note feed. Bring series above new videos.
- Add compact section shortcuts and a Membership invitation. Hide the invitation for the member
  preview. Membership value also appears in concrete series, guide context and access states.
- On mobile, topics and series are horizontal rails; all section headings still offer a route
  to their full sample collection. Material cards preserve the main visual treatment.
- A small sample catalog makes topic, format and collection navigation usable. It has local
  title/description search. It is a prototype destination, not a redesign of production Library.
- Keep series composition, standalone video, guide A → B, tags and explicit reading context.

## Content boundaries

Eight video episodes come from the brief's Telegram references. The Home cards use their episode
summaries as descriptive titles; the reader retains numbered episode titles. Guide A/B are planned
samples. A demonstrates free reading in development; no real free publication has been chosen.
Two illustrative notes are reused from main's existing fixture to retain the feed and its density;
opening them clearly states that a full authored text is absent. Topic assignment and order are
sample presentation choices, not accepted taxonomy. Artwork is illustrative. Video playback is a
labelled placeholder. No prices, payments, publication schedule or learning outcomes are invented.

## Review walkthrough

1. Compare A with the main composition at 390 × 844 and 1440 × 1024.
2. Use the shortcuts to reach new videos, guides and notes; inspect the mobile series rail.
3. Open all videos, search for Storybook, open episode 7, then use browser Back.
4. Open a topic, all series, all guides and all notes; verify the relevant sample destinations.
5. Open the guide series → A → B; inspect visitor access and the member body.
6. Copy the instruction, download TXT, follow #agents, then choose a reading-series context.
7. Inspect the member Home: content stays discoverable and the Membership invitation is absent.

## Verification

The previous reader implementation at `12525bd` passed web typecheck, focused lint, docs,
web guardrails, Storybook build, both review axes, responsive inspection and the axe addon.
Its copy/download, A → B, standalone tag and second-series paths were verified in the earlier
session. Those results are historical and do not constitute acceptance of the revised Home.

Revision checks and review closure are recorded below after completion.

Not tested: full repository `pnpm check`, complete automated browser suite, production auth,
playback, payments or publication. No backend or production contract changed. No responsive images
have been attached to GitHub. The proof remains isolated from production; #290 stays open until
owner visual acceptance and a separate production implementation handoff.
