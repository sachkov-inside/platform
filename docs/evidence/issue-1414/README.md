# Issue 1414 proof evidence

Proof branch: `prototype/unified-guide-task-reading`.
Fixed base: `da5bad690eda14a1361d66cdacd16e1c886a8a8a`.
Preview: http://localhost:6207/?path=/story/prototypes-unified-guide-task-reading--playground.

The initial batch includes A/B/C, real guide and task, 1440/390 CSS px, task body and submission regions.
Whole-page desktop captures use the shared application-scroll screenshot helper.
The metrics record the normal-size geometry; initial narrow captures cover 720, 320 and 390 with 200% root text.
Initial white canvases are historical evidence. The owner requested warm gray canvases for confirmation.

Focused TypeScript and lint passed. The initial Storybook MCP focused test/a11y run passed.
The Impeccable detector reported advisory type-ramp differences only; approved Reader sizes take precedence.
The first full `pnpm check` failed at the Web architecture boundary: `task-submission.tsx` imported a Storybook fixture.
The entry and task support now use the existing `*.fixtures.tsx` isolation contract. Guardrails remain unchanged; focused Web guardrails passed.
The owner deferred a second prototype full check. The required complete `pnpm check` runs once on the final production integration head.
This proof has passing focused TypeScript, type-aware lint, Web guardrails, documentation and Storybook test/a11y checks.
Owner visual verdict: pending. This record grants no production promotion or merge.

Screenshot names identify variant, surface, width and region.
WebP copies preserve useful evidence outside production assets.

## Owner-selected combined B

`confirmed/` is historical evidence from before the selected B header/footer/left-rail refinement.
Its B screenshots show the earlier right-contents composition and must not be treated as the selected design.
`combined-b/` records the final owner-refined B only. `metrics.json` and `interactions.json` identify the exact code commit and proof subtree.
The selected direction comes from `prototype/course-reader-programme` at `77a65abae16d57008fc9e2278942677ccc65e724` (PR #1413).
The owner superseded the original repeated-pager requirement for B: position above title, quiet metadata/actions below, named neighbouring steps below the article.
The rail is 240 px, its text is 14 px/1.6 at constant weight 400, and the existing shared Select replaces the native chapter picker.
Mobile retains the existing full-programme dialog/tree. No Select portal enters the native dialog.
The original programme proof and production assets remain unchanged from the fixed base.

The owner accepted B as a direction and authorized subsequent real-route integration.
The coordinator assigns that integration's branch and scope. Final production visual GO and deployment remain gated.

## Standards axis

Independent review of `037ab42b` found the missing horizontal-overflow assertion and literal radius values.
The capture now asserts `scrollWidth === clientWidth` before capture. Whole pages use the existing shared helper, as required by frontend-delivery:144.
The CSS now uses globals `--radius-sm/md/lg`, retaining 0 and 50% for shape geometry (frontend-delivery:94–96).
The active rail rectangles now use descriptive names. The duplicate throwaway scenario type was retained as permitted.
Corrections are implemented; the coordinator records independent final delta confirmation in #1414.

## Spec axis

Independent review of `037ab42b` passed canonical copy/criteria, programme order and truthful in-memory task controls.
Its required touch-target correction expands the 36 px visible actions horizontally and vertically to at least 44 px.
Adjacent actions use 8 px spacing so expanded targets do not overlap.
The latest B replacement follows direct owner feedback; A/C retain the shared repeated-pager comparison.
Corrections are implemented; the coordinator records independent final delta confirmation in #1414.

## Targeted sidebar evidence

`combined-b/sidebar-wrap.json` records exact text line breaks using per-character Range rectangles after fonts load.
Before the fix, task/pipeline/task changed pipeline's line breaks despite equal row heights.
After the fix, all three states use 14 px/400 and identical line-break strings.
Sidebar hover changes text color without a filled background or animation.

## Final B confirmation

Code commit: `5b34fba14cfe9f3d01d6148cebf90704452e77ef`.
Proof subtree: `209910224281cb5bbce8aba11a5d84a3db55507f`.
`combined-b/metrics.json` records ten guide/task layouts: 1440, 390, 720, 320 and 390 with 200% root text.
Every case passed the horizontal-overflow assertion. Narrow/enlarged cases also passed visible-label clipping and 44 px action-target checks.
Reading-state text remains visibly present at 320 px, as required by the delta Standards review.
The final browser context uses reduced motion; the helper still performs its normal settled-layout checks.
Fluid diagram padding prevents enlarged GitHub labels from losing their reading space.

`combined-b/interactions.json` records custom Select selected state, keyboard chapter changes and restored focus after Escape.
The programme dialog contains all 34 steps. Guide/task/pipeline/back and browser Back passed; task bookmark/read actions are absent.
Ready/history/unavailable/version/closed/expired form states passed. No outbound POST/PUT/PATCH/DELETE request occurred.
The canonical agent-choice comparison uses the existing page-model helper. A targeted browser check found five choices and switched to the GPT card.
The helper exists in the accepted parent Reader lineage; the coordinator selects its production preservation scope separately.

Normal-size geometry preserves the 688 px reading column, 28/18 px desktop title/prose and 22/15 px mobile title/prose.
The final B screenshots cover header, footer, submission, selector, overview and Brief focus.
The selector capture waits for the complete frame; the earlier compositor frame was replaced without a design change.
Very tall whole-page PNGs remain local; versioned WebP `part-NN` tiles preserve the complete geometry at its original scale.
Independent final delta confirmation is recorded by the coordinator in #1414.
