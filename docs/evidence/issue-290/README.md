# Prototype #290: Home, series and materials

Status: first implementation for owner review; no visual acceptance or production adoption.

Input: [Platform #290](https://github.com/sachkov-inside/platform/issues/290) and the
[accepted Workspace #112 brief](https://github.com/sachkov-inside/workspace/blob/b534239889ffabd774e220e7d91b9d13f755c800/product/content-series-authoring-brief.md).
Base: `188f92ae3bc674ca43a2f4aabbcc454ac22addbf`.

Run `pnpm storybook` from the task branch, or the repository's Storybook Compose profile.
The catalog entry is `Pages / Inside showcase 290`. Only this prototype is explicitly added
alongside the production catalog; earlier proofs remain excluded.

- A: `/iframe.html?id=pages-inside-showcase-290--value-first&viewMode=story`
- B: `/iframe.html?id=pages-inside-showcase-290--series-first&viewMode=story`

The floating control compares A/B. Links preserve variant, screen, membership preview, episode
and reading-series context in the URL. Browser back/forward is supported. The expandable
`Прототип #290` panel switches visitor/member presentation. Agentation remains enabled.

## Composition question

A leads with audience and value, then a two-column series selection. B leads into two editorial
series rows with the same content. Both keep the accepted ApplicationShell, typography, semantic
tokens and static artwork from #271. Artwork is illustrative, not the real video cover.

Both show eight video episodes documented from Telegram and two planned guide samples. Guide A
is explicitly a development-only free sample; B demonstrates the subscription boundary. Video
playback is a labelled placeholder. Prices, payments, publication, learning results and cadence
are not fabricated.

## Review walkthrough

1. Compare both home compositions at 390 × 844 and 1440 × 1024.
2. Open the video playlist, then episode 5; switch to member to inspect the player placeholder.
3. Open the guide series → A → B; inspect the visitor boundary and member body.
4. Copy the guide instruction and download the demonstration TXT.
5. Follow #agents → open A separately → choose its series → follow the next step.
6. Select the second explicitly labelled test series. The material stays the same; a next step
   is not invented when this series has no selected continuation.

## Differences to the earlier Home contract

- Product explanation and series intent precede the old format-first sequence of topics,
  new videos, playlists, guides and notes.
- Video playlists and guide series have distinct presentation without renaming domain Series.
- Reader introduces an actionable tag, explicit reading context and A → B navigation.
- No standalone Workshop, progress tracking, full Library redesign or new production shell.

These are proposed changes, pending owner choice. Do not update accepted product/UX contracts
or promote this code into production before that choice and a separate implementation scope.

## Verification — 2026-09-05

Checked on prototype commit `fc8c9fa` using the pinned Node/pnpm Storybook image:

- Web typecheck: passed.
- Focused oxlint: 0 warnings, 0 errors.
- Documentation contract: passed.
- Web architecture and negative guardrails: passed.
- Storybook build: passed.
- Standards and Spec review against `188f92ae3bc674ca43a2f4aabbcc454ac22addbf`: 0 remaining
  findings on both axes. Fixed the second-series return and episode 5 description before re-review.

Interactive Chrome review covered desktop 1440 × 1024 and mobile 390 × 844. Screenshots were
inspected in the review session. Both Home layouts retain the accepted shell and fit the viewport.
Measured mobile document width was 390 px on B, video and standalone guide A.
The A/B switcher changes the URL. Browser Back restored tag results after opening a material.

Confirmed journeys: Home → guide series → A → B; visitor B has no body and member B exposes it;
#agents → standalone A retains `series=none`; choosing the second test series and returning to
its contents shows that series with one A; standalone video 5 has the agreed description and a
labelled placeholder. Copy reports success. The downloaded `agent-task-prompt.txt` was compared
byte-for-byte as UTF-8 text with the fixture instruction and matched.

Manual accessibility review checked semantic headings, named controls, focus on the reader
heading after navigation, native select/links and the live copy status. Agentation stays enabled.
The floating A/B control is review chrome, separate from the accepted mobile dock.

Not tested: automated axe suite, full repository `pnpm check`, production authentication,
playback, payments or publication. These are not implied by the prototype checks. No backend or
production contract changed. Responsive screenshots have not been attached to a GitHub issue;
owner visual selection and any resulting revisions are still pending. The proof is not a
production-ready feature, and #290 must remain open until its owner acceptance and handoff.
