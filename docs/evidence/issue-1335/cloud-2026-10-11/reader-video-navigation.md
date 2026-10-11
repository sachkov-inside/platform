# Reader Video fragment and intent-cache evidence

[PR #1347](https://github.com/sachkov-inside/platform/pull/1347) is Part of
[#1335](https://github.com/sachkov-inside/platform/issues/1335) and
[#1338](https://github.com/sachkov-inside/platform/issues/1338). The Video rollback has a
confirmed producer and a focused RED/GREEN comparison. The historical guest navigation producer
was **not reproduced or fixed**. Both issues remain open; a focused branch result does not replace
complete final-head checks or a green main nightly after merge.

## Source and cloud runtime

- Starting main: `e00efc1c9ee53462462e6eb6eff734a2d17fb827`.
- Required starting evidence: [#1340 nightly handoff](../../issue-1337/cloud-2026-10-11/nightly-handoff.md),
  exact infrastructure source `a76b8a198b814773ad395fa3d8d19a1aaf2bb99d`.
- Main integrated without rebase: `f5a6d87597d0d3b5408d6bf25fc474c41ca8d06b`.
- Final focused Video comparison: `a00d765a87fc61d746e527e7df75345393949417`.
  Baseline temporarily reversed only the three production lines in
  `material-primary-video.client.tsx`; an EXIT trap restored the file immediately.
- Guest diagnostic: `e91c9dc379d71cb2ff9562e85c5c60322f94fbfe` plus the explicit prepared
  `intent-cache-admission.spec.ts`, SHA-256
  `d1e9d0af83c2c033192d29106a0922086a58645a94c6f7ea2a57dc999bcd7fe0`.
- Ready dependency #1346 was included by an ordinary merge of
  `8a9fb1790b4a6eb9ed67396bcaaca955fa243d53`; its Notifications fixture blob
  `82efbf71dc8c141f162057eb7f1c5a682a388b56` was preserved without manual edits.

All commands ran in the cloud writer worktree with pinned Node 26.10.0, pnpm 11.27.1,
Next 16.3.8 and Playwright 1.63.0. The approved Playwright image used digest
`bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7`.
Original test budgets and zero retries were retained. The repository heavy guard remained active.
Configured proxy and CA trust were preserved; shared containers, volumes and the primary checkout
were untouched. Each fullstack run used fresh owned PostgreSQL/RustFS resources and a fresh owned
Playwright container. Runtime resources were removed after each run.

## Video: applied refresh before SDK release

The earlier diagnostic captured the actual stale writer: Next's `HistoryUpdater` insertion effect
called `history.replaceState` with its stale canonical URL, changing `#t=261` to `#t=3` while the
initial SDK seek to 3 was still held. The production change calls the supported
`history.replaceState(null, "", window.location.href)` for a valid fragment event before serialized
seeking. Reader content, access rules and shared refresh semantics are unchanged.

The permanent test holds a real successful saved-open browser response. Its public forwarding
observer first acknowledges the hash's null-state external History call with a subsequent non-null
write of the same href while open is held. It then arms a separate refresh phase, rejects any
matching pre-release RSC request, releases open, and waits for the matching RSC body and post-request
non-null History write. `Response.clone()` observes the body without consuming the router's copy.
The initial SDK seek remains pending until URL and seek assertions permit its release. Wrappers
restore in finally; the open gate and owned published fixture are cleaned on failure too.

| Run | Desktop | Mobile | Meaning |
|---|---|---|---|
| Earlier original baseline | PASS | PASS | Nonreproduction; no fix claim |
| Earlier controlled producer diagnostic | `#t=261 → #t=3` before SDK release | Earlier original `#t=0 → bare URL` failure | Desktop writer stack confirmed |
| Final strengthened baseline, EXIT 1 | Earlier original `#t=0 → bare URL` failure | `#t=261 → #t=3` after completed refresh, pending SDK seek 3 retained | Final observer reproduces rollback; no unchanged rerun |
| Identical fresh fixed head, EXIT 0 | PASS, 27.1 s | PASS, 23.7 s | 2/2 passed in 54.5 s |

Final baseline mobile ledger: no early RSC, no external-null phase, request start 1626 ms,
non-null refresh write to `#t=3` at 1838.3 ms (+212.3 ms).
Fixed desktop: null hash write 660.6 ms, same-href acknowledgement 662.3 ms, RSC start 690.5 ms,
refresh write retaining `#t=261` 767.1 ms (+76.6 ms).
Fixed mobile: null write 500 ms, acknowledgement 501.5 ms, RSC 530.7 ms,
refresh write retaining `#t=261` 612.1 ms (+81.4 ms). Both fixed ledgers had no early RSC.
Both projects passed pending seek 3 and URL 261 before SDK release, then final seek and URL 261.

Independent Standards and Spec reviews on `a00d765a` returned zero findings. Two earlier review
findings are preserved: response headers plus an already-set URL were not an applied-refresh
barrier; a proposed title marker incremented contentVersion and would remount the player. Neither
approach remains. [CI run 38138843596](https://github.com/sachkov-inside/platform/actions/runs/38138843596)
on former `14d77931` failed Static/Telegram lint on a void resolver/shorthand release. Scoped lint,
format and Web typecheck subsequently passed. Final complete checks and CI belong to the final PR
head and are reported in the PR result card.

## Guest intent cache: current admission, historical cause unresolved

The exact href is:

```text
/materials/navigation-lesson-2?from=%2Fproducts%2Fnavigation-proof%2Fprogramme%3Fpage%3D1%26at%3Dnavigation-lesson-2
```

The test obtains the actual programme anchor, completes its exact-context Runtime PPR intent
response (`next-router-prefetch: 2`, excluding segment prefetch), preserves untouched bytes, and
holds only subsequent matching non-prefetch navigation RSC. It checks the public Reader title,
body, return href and absence of a visible Reader skeleton while the gate remains closed.
Its public fetch ledger excludes a second post-click matching prefetch supplying the Reader.

Preserved preparation results:

1. First observer: both projects timed out at 30 s waiting for generic RuntimeShell
   `requestfinished`. Its real HTTP 200 response was aborted (`net::ERR_ABORTED`); this was an
   observation/preparation failure before intent or click, not a product failure.
2. Corrected clone observer: 2/2 passed, but GREEN traces were discarded by retain-on-failure.
   Missing post-click prefetch evidence limited attribution; this result is retained as such.
3. Final explicit ledger: EXIT 0, desktop 1.4 s/mobile 948 ms, 2/2 passed in 24.8 s.
   Both projects had exactly one post-click same-context non-prefetch RSC with no response yet,
   matching the held route; there were **zero** post-click matching prefetch requests.
   The Reader body/context were visible and `sawReaderSkeleton` was false.

Clone consumption matches the existing instant-navigation public probe and changes transport
consumption lifetime compared with the first observer. It is observation preparation, not a
product fix. The generic shell preparation requires a completed HTTP 200 body for compatible
`^/materials/[^/]+$`; it is separate from the exact lesson intent response condition.

Both final intent responses were HTTP 200, `text/x-component`, stale time 60, and had no rewritten
path/query headers. Both began with `~` and contained 36526 bytes. Next's partial-response marker
therefore does not establish missing public Reader content.

| Project | Untouched response SHA-256 |
|---|---|
| Desktop | `7eabb16244a5b850b3ab1b3e343d3427490f577ce4dca449ede29b8188084f16` |
| Mobile | `98f590a6465a50e7f707a551f4c059ff8e2a8ea115c63e9e9fe665b2b751f886` |

Historical run 38039613318 on `af1cab04` had a real guest Reader skeleton after a completed
HTTP 200 intent response. Historical raw artifact 11666005162 remains inaccessible in this cloud:
the connector returns a File Service URL and normal retrieval returns 403. No network/policy bypass
was attempted. Current admission does not explain or fix that historical producer. No navigation
production change is justified by this evidence, and #1338 stays open.

## Retained artifacts and verification boundary

Raw local artifacts are preserved under `.reports/reader-video-1335/` in the writer worktree:

- `fullstack-setup-red.log`, `fullstack-namespace-setup-red.log` retain initial isolated-runtime failures.
- `fullstack-original-baseline-*` and `video-producer-red-*` retain earlier results and producer traces.
- `final-video-baseline-*` include the exact reverse hunk, exit, log, HTML report and both failure traces.
- `final-video-green-*` include actual exit/log/report and both extracted History ledgers.
- `intent-cache-admission-shell-observer-failure-*` retain the first preparation failure.
- `intent-cache-admission-corrected-*` retain the limited-attribution GREEN.
- `intent-cache-admission-final-*` include final source/hash, exit/log/report, metadata,
  gated observations and untouched `.bin` responses whose hashes match the table.

These focused checks do not replace required unfiltered `pnpm smoke:fullstack`, full `pnpm check`,
final-head independent review/CI or the issue's green-main-nightly completion condition.
No merge, deployment, price/access/content change or issue closure was performed.
