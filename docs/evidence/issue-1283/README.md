# Reader quizzes — #1283

Synthetic fixture evidence; no actual Content package was applied.

## Storybook MCP gate

The writing session owns port 6006 under `/tmp/platform-orchestrator-6006-1283.md`.
The native Storybook tools were unavailable. The owner explicitly authorized a real HTTP MCP client.
The untouched session config already addressed 6006.

Raw server-sent protocol responses are in [mcp](./mcp/): initialize, tools/list,
docs-list, docs-show Button, docs-show Material Reader, story instructions, changed stories and previews.
The documentation calls preceded UI implementation. These are protocol responses, not copied source files.

Start command: `pnpm storybook` after checking `lsof -nP -iTCP:6006 -sTCP:LISTEN`.
Only this session's Storybook process may be stopped. Port 6007 and the shared stand remain untouched.

## Reproduce screenshots

```sh
CAPTURE_EVIDENCE=1 pnpm --filter @inside/web test:fullstack --config playwright.quiz.config.ts storybook-quiz.spec.ts
```

This checked-in wrapper enters the shared heavy-check FIFO. The config does not start a web server.
Ten tests cover five states at 1440 and 390 pixels, keyboard Enter/Space, retry focus,
review-heading navigation, reload reset, horizontal overflow and axe on the quiz.
The fixture uses the production Reader and public page shell. Agentation stays enabled.
Screenshots use `screenshotWholePage`; the page scroll is reset before capture.
The writing agent opened and inspected all ten final PNG files before committing them.
The quiz cards and explanations remain readable; no horizontal overflow appeared.

Preview: [Unanswered](http://localhost:6006/?path=/story/pages-material-reader-quiz--unanswered),
[Don't know](http://localhost:6006/?path=/story/pages-material-reader-quiz--dont-know).

## Remaining gates

The isolated Reader/editor route awaits #1284's configurable internal web port and current Content receiver.
No compatibility bypass or actual Content application is allowed here.
Root owns #56 and the immutable chapters 1–2 package application after runtime handoff.
Final checks, CI, independent review and production visual GO must precede merge.
Platform-orchestrator owns the unified candidate. The v32 freeze is lifted; only the coordinator may enqueue this PR after its gates.
