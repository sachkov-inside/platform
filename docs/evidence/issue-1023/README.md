# #1023 — Storybook MCP memory and child lifecycle

## Reproduction

Host: macOS, Node `26.10.0`, pnpm `11.27.1`, Storybook/addon-vitest `10.6.1`.
Run from the repository root with an orchestrator slot:

```bash
PROBE_PARENT_SIGNAL=SIGKILL node docs/evidence/issue-1023/reproduce.mjs
```

The diagnostic script starts the real Storybook CLI on 6106, samples the parent heap via Node
Inspector on 6116, and calls MCP `test-run` with `{}`. After the response it checks the server's
index, kills only the parent and checks for surviving Vitest/esbuild processes. A `finally` block
terminates its own process group. Logs and allocation profiles go to
`node_modules/.cache/issue-1023/`; it does not change the shared Compose stand.

## Before

Baseline `6fed4ca1`: 74 files / 589 tests passed in Vitest (24.78 s), but MCP never returned.
Storybook aborted around 91 s:

```text
Mark-Compact (reduce) 3617.1 (4102.7) -> 3617.1 (4102.7) MB
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
Error: Inspector closed: Storybook crashed
```

[Heap samples](memory-before.json) show the growth after the tests completed. The allocation
profile taken at 45.98 s attributed 1782 MiB to Node's `parseChannelMessages` (IPC deserialization).
Execa's `lib/ipc/buffer-messages.js` keeps each deserialized message in `ipcOutput` by default;
`addon-vitest` used those defaults for a persistent child. UniversalStore repeatedly sends both
current and previous full test-state snapshots. Their history, rather than the final MCP text or
manifest generation, retained the heap.

The minimized regression `node --test scripts/storybook-runner.test.mjs` delivered 16 synthetic
reports through the real preset. Before the fix Execa retained 17 messages (including readiness).
The second regression kept an active server in the real installed runner while initialization was
stubbed; closing parent IPC left the runner alive and exhausted the 10 s guard.

## After

Integrated #1065 (`d740bb2d`) before verification, so renamed/retired stories changed the catalog
to 585 tests. The pnpm patch disables only IPC result buffering and adds the runner's disconnect
handler. It keeps stdout/stderr buffering, all test and accessibility results and the default heap
limit.

Full MCP run on that catalog: 74 files / 585 tests passed (Vitest 26.76 s); MCP returned 27,560 bytes
at 85.66 s. Parent heap was 1334 MiB before explicit GC and 410 MiB afterward. Storybook still
served `index.json`. After SIGKILL of the parent, the process-group check found no surviving
processes, including Vitest and esbuild. [Heap samples](memory-after.json) record the complete run.
Timing includes allocation profiling and repeated serialization of upstream full-state snapshots;
this fix removes retention rather than claiming a speed improvement.

Both minimized regressions passed in 0.73 s: all 16 reports reached the listeners, `ipcOutput`
remained empty and IPC loss ended Vitest with code 0.

The root tooling suite owns these regressions. `scripts/toolchain-contract.test.mjs` also verifies
that all three application Docker dependency stages copy the patch before their frozen install.
The patch's maintenance authority is [local development](../../runbooks/local-development.md).
