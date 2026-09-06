# Connected steps within mixed Series — #298

Production implementation: [PR #300](https://github.com/sachkov-inside/platform/pull/300).
Accepted visual decision: [#301](https://github.com/sachkov-inside/platform/issues/301), with the
owner's final equal-marker refinement recorded in [#298](https://github.com/sachkov-inside/platform/issues/298).
Final application source: `fe4c5f3`; evidence-only changes follow it.
Content contract alignment: [merged Inside Content #5](https://github.com/sachkov-inside/inside-content/pull/5).

## Final presentation

The live `/series/demo-series-release` contains six ordered entries: video, preparation guide,
Docker video, note, environment guide, deployment guide. The three guides explicitly belong to
“От проекта до релиза” and show steps 1/3, 2/3 and 3/3 at overall positions 2, 5 and 6.

All six entries have the same dark filled ordinal marker. A dashed line passes through their common
axis from the first marker to the last. Step labels sit inside the original MaterialCard below its
title. Video rows use their published summary as plain text, limited to three visible lines; the
full summary remains in Reader. Covers, card metadata and the mixed reading order are preserved.
There are no primary/optional roles or a second Reader path.

The first mobile review caught unbounded video summaries making rows disproportionately tall.
The final source limits them to three lines and gives the two demo videos concise, concrete
summaries. Storybook verifies the rendered height against the three-line limit.

## Current responsive evidence

- [Final desktop, 1440 px wide](series-desktop.png)
- [Final mobile, 390 px wide](series-mobile.png)

The root coordinator captures these images from the real Compose API/web using the documented
isolated Playwright screenshot CLI, then inspects the images. CUA was unavailable in both sessions
(native pipe startup failure / browser unavailable); no final interactive CUA inspection is claimed.
Root independent visual inspection: desktop and mobile GO on `fe4c5f3`. All six markers have equal
weight, labels are inside cards, and video summaries remain compact. The mobile full-page image
shows the fixed shell at its initial viewport position; that is a full-page capture artifact.

The production route and Storybook import the same implementation. Stories verify step labels
inside the guide cards, equal marker appearance, line/marker alignment, summary height, literal
HTML-like summary text and absence of horizontal overflow on desktop/mobile.

## Unchanged navigation evidence

These earlier images document the already-verified context behavior before the visual refinement;
they do not represent the final Series card styling:

- [Same guide in another Series](shared-series-desktop.png): no step assignment in that Series.
- [Reader retains the mixed Series next item](reader-desktop.png): preparation guide is entry 2/6
  and advances to the Docker video, not directly to guide step 2.

The superseded external-label screenshots were removed; Git history preserves them.

## Verification and compatibility

The final checks and exact-head CI outcome are recorded in the PR. Focused tests cover labels,
legacy omission, clearing, optimistic composition versions, draft exclusion and MCP round-trip.
The full authoring flow previously passed the isolated full-stack suite; this visual amendment
changes no authoring, Reader, API or composition contract.

On the existing local database, changing demo summaries initially exposed an old creation receipt
fingerprint. The seed now retains the original createDraft payload and updates current summary
through ordinary Material Save. Existing-volume upgrade and repeated fresh seed pass without a
reset. API/web container source hashes match the committed application files.

## Limits and runtime

These are explicitly labelled test materials, not Kirill's real content. Real provider video
playback, content import and production deployment were not performed. The local provider is the
existing deterministic test adapter. Automatic Git import remains #289.

Singleton `inside-platform` retains named PostgreSQL/object-storage volumes. The owner can inspect
`http://127.0.0.1:3000/series/demo-series-release`. Stop without removing data:

```sh
docker compose -p inside-platform stop
```
