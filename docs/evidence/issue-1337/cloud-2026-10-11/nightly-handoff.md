# #1335 / #1338 — exact failures and the next owner

## #1335: current main failure and verified corrections

[Nightly 38120663673](https://github.com/sachkov-inside/platform/actions/runs/38120663673),
attempt 1, Source `e00efc1c9ee53462462e6eb6eff734a2d17fb827`, reached the browser suite after
successful setup. It failed on duplicated Reader actions, the retired practice slot/button,
primary Video seek, feed count and shared Product ordering. Infrastructure setup was not the cause.

The native full suite on `44ba65fb138ad92f7928c2ec4d14694610d49634` used its own fresh PostgreSQL
database, RustFS volumes and ports 13000/13001/13002. It finished with **158 passed, four existing
project-specific skips and six failures**, exit 1. Infrastructure preparation took 4.012 seconds;
the command including migrations, seed, Web build and browser startup took 686.661 seconds.
It did not seed, restore or modify the shared stand. This is not a full-stack PASS.

Confirmed fixes in this PR:

- Available Reader actions use their exact semantic navigation; conflict refresh no longer matches
  both top and bottom buttons. A denied Reader uses its real `access-required` action below the
  invitation, rather than the disabled top placeholder. Identity, conflict and mark assertions remain.
- Practice selectors follow the current accessible icon button and loading/summary slot. Geometry,
  authorization and public-body assertions remain.
- Keyboard reordering owns and archives a separate Product, preserving the canonical seeded order.
- A failed Video test now unpublishes its own Material in `finally`, preserving its primary error.
  In the native RED suite, the failed mobile test's `video-flow-…` was the sole extra published free
  feed row: count 31; the successful desktop row was unpublished. After the cleanup correction,
  the failed desktop test left zero published `video-flow-…` rows and feed count 30.

The fresh focused check on `37eb1f7c6fd2d4519d12850eada5f1d6a75945bd` ran
`FULLSTACK_TEST_GREP='uploads, resumes|reading progress|loads successive' pnpm smoke:fullstack`:
**13 passed / one failed**, exit 1. Both projects passed all reading-progress and pagination cases.
Preparation took 4.848 seconds; the command including application preparation took 152.049 seconds.
The browser reporter measured about 1.4 minutes; the remaining time is not solely dependency install.

## #1335: remaining primary Video URL failure

Case: `apps/web/test/fullstack/material-authoring.spec.ts`,
`uploads, resumes and replaces one primary Video while keeping provider bytes behind authorization`.
Native Source `37eb1f7c6fd2d4519d12850eada5f1d6a75945bd`; desktop failed, mobile passed.

After visiting the owned Material with `#t=3`, the SDK double holds its initial seek. The test sets
`#t=261` and now waits for the matching `HashChangeEvent.newURL`, not any queued event. That event
arrives, but the following URL assertion receives **`#t=3`**, before releasing the SDK seek.
The older full-suite failure instead reached the seek assertion: expected 261, received 3.
This narrows the failure to same-document URL coordination; assigning it to a particular Next.js
internal effect without further instrumentation would be speculation. The real BFF, authorization,
progress storage and browser are used; only the external Video SDK is replaced.

**Next owner:** the orchestrator assigns one writer for the Reader/navigation Source under #1335,
coordinated with #1338. Reproduce the exact case on a fresh isolated database; inspect URL/history
updates during initial player loading; fix the confirmed producer of the rollback. Keep both async
seek ordering assertions, original budgets and zero retries. Require a fresh complete main nightly
after the fix. The PR's ordinary green CI does not close this product boundary or #1335.

## #1338: real skeleton after successful full prefetch

[Flake run 38039613318](https://github.com/sachkov-inside/platform/actions/runs/38039613318),
attempt 1, Source `af1cab0488a01707daeac64f83b5521076ac4b71`: one failure in five independent
mobile navigation runs. Artifact 11666005162 (`flake-web-e2e-1`) contains the fifth run's trace
`0b410c87c9eaf55fcec6c9e0aebee5887b68238d.zip`.

The lesson-2 full prefetch (`next-router-prefetch: 2`) began at 09:12:16.897Z, completed HTTP 200
in 14.216 ms, and had stale time 60. Clicking requested the same lesson/context again without the
prefetch header at 09:12:16.990Z, HTTP 200 in 19.286 ms. The transition probe recorded
`skeletons: ["material-reader"]`, one navigation request and zero pending requests. A DOM snapshot
at trace time 51825.7 contains the actual loading region, without a hidden ancestor: this was not
a measurement of an invisible retained page. Backend delay was 700 ms, but this transition took
about 25 ms; blaming backend timeout or runner load is unsupported.

Five fresh independent mobile samples on `37eb1f7c6fd2d4519d12850eada5f1d6a75945bd` used the
existing production build, `--repeat-each=5 --retries=0`, and passed 5/5. Browser execution took
9.1 seconds; the Docker/CA/server wrapper took 23.941 seconds. No navigation implementation was
changed, so this observation neither diagnoses the client cache miss nor establishes a fix.

**Next owner:** the orchestrator assigns one navigation writer in #1338. Inspect why the completed
full-prefetch result was unavailable to the click's client transition, using the exact failed trace
and route/context above. Preserve the no-skeleton assertion and zero retries; confirm the fix with
fresh independent samples and green main nightly. #854 waits for these product boundaries and its
own production acceptance. Merge queue and deployment are performed by the orchestrator.
