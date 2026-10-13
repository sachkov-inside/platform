# Course Reader programme prototype

Question: can a compact programme rail make lessons and tasks discoverable while preserving quiet reading?

Owner reference: the supplied Anthropic guide screenshot. Preserve the incumbent fonts, tokens and public shell.

Three structural alternatives on one Storybook route:

- A: all chapter headings, with the active chapter expanded; rail starts beside the body, as in the reference.
- B: one chapter at a time, selected above a linear list; rail starts beside the title.
- C: a small window around the current step, with the complete programme behind one action.

## Owner decision: B, 2026-10-13

The owner selected **B as the navigation direction**. It remains a prototype and needs refinement.
The owner will refine it in another Codex session. This session records the selection only.

Preserve B's core composition: a compact left rail, a chapter selector, and the current chapter's linear step list.
Materials and tasks share one ordered sequence. Next and Previous traverse both step types.
Keep the current step visible and distinguish task steps. Preserve the existing Reader typography and public shell.
Keep A and C as comparison evidence. The owner has not specified the remaining refinements yet.

Use the selected prototype as a design reference for the receiving session's own worktree.
Import the prototype directory and its public assets if a runnable comparison is needed; keep unrelated work intact.
Production integration follows a separate implementation assignment.

## Running the comparison

Use `?variant=A|B|C`, `step=<id>` and optional `theme=dark` on the iframe URL.
The floating prototype bar cycles variants, including keyboard arrows outside interactive controls.
Chapter-one document bodies and all 34 programme steps were captured read-only from the existing local API.
Thirteen public assets are copied locally. The proof can render without a live database.
Task steps follow their actual `afterMaterialId` placement. All variants share that sequence.
Closed chapter-two steps retain their place and show a safe access state.
Local read/bookmark toggles have no persistence. No submission, auth or production mutation is connected.

Run from the repository root:

```bash
pnpm storybook --port 6206 --ci
```

Open `http://127.0.0.1:6206/iframe.html?id=prototypes-course-reader-programme--playground&viewMode=story&variant=B`.

This is throwaway presentation on `prototype/course-reader-programme`, outside main and all production routes.
The running owner frontend on 3100 and shared API/database remain unchanged.
Decision recorded: B is the basis for further refinement. The receiving session owns those refinements.
