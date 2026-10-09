# Reader quizzes — #1283

Synthetic fixture evidence; no actual Content package was applied.

## Storybook MCP gate

The original writing session used the owner-authorized HTTP MCP client on port 6006.
Its raw server-sent protocol responses remain in [mcp](./mcp/).

The cloud continuation on 2026-10-09 used the same real MCP endpoint from this task's
worktree. Catalog, Reader documentation and story instructions preceded the UI change.
The raw responses are in [mcp/cloud-2026-10-09](./mcp/cloud-2026-10-09/).
The new rich-option story failed before the pointer-events fix and passed afterwards;
all six quiz stories passed the final MCP test-run with accessibility enabled.

Start command: `pnpm storybook` after checking that port 6006 is free.
Only the task session's Storybook process may be stopped.

## Reproduce responsive and live evidence

Start the isolated `pnpm editor:local` runtime with its documented development database
and object storage, then run:

```sh
CAPTURE_EVIDENCE=1 pnpm --filter @inside/web test:fullstack --config playwright.quiz.config.ts
```

This checked-in wrapper enters the shared heavy-check FIFO. The config does not start a web server.
Twelve tests cover five Storybook states plus the real Reader/editor route at 1440 and 390 pixels.
They check keyboard Enter/Space, retry focus, review-heading navigation, reload reset,
horizontal overflow and axe on the quiz. Agentation remains enabled for manual review;
automation hides both its root and its shadow-DOM toolbar/portals.
Screenshots use `screenshotWholePage`; the writing agent inspected all twelve final PNG files.

The live tests reserve and apply a synthetic Content fixture through the real authoring API.
The imported material stays protected in the editor. A separate editor-owned draft with the same
quiz allows an adjacent paragraph to be edited, autosaved and reopened; its quiz node remains
identical before and after saving. The new rich-option Storybook test also checks callout expansion,
image zoom, Escape and image retry without choosing an answer.

Preview: [Rich option content](http://localhost:6006/?path=/story/pages-material-reader-quiz--rich-option-content),
[Unanswered](http://localhost:6006/?path=/story/pages-material-reader-quiz--unanswered).
These local links require Storybook to be running from the PR worktree.

## Remaining gates

The receiver and configurable internal web port from #1284 are merged and were used by the live test.
The real immutable chapters 1–2 Content package from #56 has not been applied in this session.
Its transfer and author acceptance remain separate from synthetic fixture verification.
Final checks and CI on the final head, independent review and a new production visual GO precede merge.
The earlier prototype GO does not accept the production implementation.
Only the coordinator may enqueue this PR after its gates; production deploy is outside this session.
