# Local Web memory investigation, 15 November 2026

Source before this change: `83f9be764d1f4b1d0c67b90f45f890ee4b4f8939`.
Issue: [#1332](https://github.com/sachkov-inside/platform/issues/1332).

## Native observations

Read-only inspection of the existing `inside-platform-web-1` at 06:20 UTC found nine restarts,
a 6 GiB RAM cap, an 8 GiB combined RAM/swap cap and `restart: unless-stopped`.
The logs contain `Killed` and exit 137 at 20:16 UTC on 14 November and 00:33 UTC on 15 November.
The sampled cgroup reported `memory.peak=6442450944`, `memory.current=6262194176`,
`max=10280`, `oom=0` and `oom_kill=0`. Exit 137 and a reached cap do not alone prove an OOM kill.
The October recovery receipt named in the issue is absent at its recorded path on this machine;
its historical kernel cause remains unknown.

A later read of Next's existing `.next/dev/trace` contained 569 memory observations.
After the first 100 requests, all remaining observed requests were `/`. In successive groups
of 100 requests, minimum process RSS rose from 2,037,248,000 to 2,391,666,688,
2,842,607,616 and 3,288,023,040 bytes. Minimum JS heap use rose from 381,271,200 to
519,458,912, 640,634,016 and 759,797,392 bytes. The final partial group contained 69 requests.
These are process measurements after ordinary requests, not forced-GC retained-heap measurements.
They show growth during homepage polling; they do not identify the retaining object or exclude
an upstream runtime/compiler defect. The runtime changed between inspections, so the later trace
is not claimed as a measurement of the earlier container's complete lifetime.

## Isolated diagnostics

Temporary host fixtures used the installed Next 16.4.6, separate ports in the test range,
synthetic content and the repository's owned-process supervisor under a heavy-check slot.
Each attempt had a 60-second deadline and a 1.5 GiB process-tree RSS stop limit.
The minimal dynamic-page fixture served 300 requests: RSS was 746,258,432 bytes after 50 requests
and 749,535,232 after 300, with a process-tree peak of 871,858,176 bytes. This did not reproduce
the stand's sustained growth.

A second minimal fixture returned a synthetic 500,000-character text node. It also completed
300 requests: process RSS was 942,620,672 bytes at the end and process-tree peak was
1,047,986,176 bytes. Its final JS heap was 136,438,840 bytes and ArrayBuffers 84,657,733 bytes.
This different payload is a diagnostic only, not a reproduction of the application's course.

An actual-page fixture with the navigation test backend first failed on fixture configuration;
after that was corrected it reached the RSS stop limit while compiling `/`, before a successful
response. It provides no pass or reproduction evidence. The limit was not increased.
Owned servers were stopped and temporary source/build directories removed. No shared containers,
volumes, accounts or content were changed.

## Bounded correction and remaining acceptance

The previous Compose probe rendered `/` every two seconds and accepted its HTTP 200 even if
operational readiness failed. A behavioral test runs that actual probe against a loopback HTTP
fixture. Before the change it exited 0 when `/` returned 200 and `/_health/ready` returned 503;
the expected exit was 1. The corrected probe uses the existing readiness route, checks its HTTP
status and bounds its request below Compose's own timeout. A successful probe requests only
`/_health/ready`, so it cannot render the homepage.

This correction removes the demonstrated recurring render workload. It does not close #1332.
The owner retained the shared stand's current review reservation. Pending checks are a measured
before/after runtime comparison, retained-heap attribution, stable programme/lesson reading,
no unexpected restart or OOM, and preserved stand identity/data. The normal memory caps remain
provisional. #1327 also still needs a complete guarded local Compose smoke; the code changes
already merged in #1340 are not a substitute for that runtime proof.


## Follow-up on 16 November: request cache GC timers

Kernel evidence from OrbStack confirms a November cgroup OOM for Web container
`5dcd239006e72565b4a11e0d99d46a8c6ceaa2204800ba77b488609546845c0a`:
`CONSTRAINT_MEMCG`, Next process 1080417 killed with `anon-rss=6040704kB`.
This establishes the current failure classification; it does not recover the October kernel history.

The first root-path trace through an internal Error was not sufficient causal evidence.
After excluding conditional WeakMap edges, the strong retaining path was an active 1,800,000 ms
Timeout, its `kAsyncContextFrame`, React's `onAllReady`, and the rendered response streams/buffers.
The timer callback was TanStack Query's `optionalRemove`. Our shared QueryClient explicitly set
30-minute query GC for both browser and server. Server clients are per-request, so those timers
kept the request context alive after responses completed. Browser GC needs its existing window;
server clients need no GC timer. `gcTime: Infinity` disables it without sharing request data.

The new module test first failed with one remaining server timer instead of zero. Both tests pass
after the fix: server request isolation/no timer, and browser freshness/cache lifetime. In an
isolated production image, changing the server factory to disable GC timers reduced retained
memory after 160 requests and expiration of short HTTP deadlines to 69,944,344 bytes JS heap and
712,989 bytes ArrayBuffers. No experimental Error, V8 or vendor changes are part of the fix.

The existing stand has a custom migration registry. Runtime validation therefore used local
verification commit `631bec1b6f18a0e868dd0b1daf75b6e7015e7e05`, based on the unchanged stand
`344b9acd343890f2ee37f2566181db1b2700b52e` plus the QueryClient fix, tests and ADR paragraph
cherry-picked from PR implementation commit `3d8d0978ac2656948ba3e98b64029991b8730a83`.
These are separate revisions, not a claim that the stand runs the PR's complete tree.
The registered controller prepared production-Web without migrations or identity bootstrap.

Authenticated HTTP validation then completed 900 sequential reads over the programme and eight
real lessons in 62.57 seconds. Every response was 200; lesson bodies contained their article,
and the representative design lesson contained its expected heading. Web had zero restarts,
no OOM counters and a sampled peak of 279,769,088 bytes under its unchanged 1 GiB cap.
The production API and Web retained equal source identity. Existing named volumes and all six
infrastructure container/image identities remained unchanged. Browser inspection as the learner
confirmed the actual programme and lesson body at desktop and mobile widths. This is a bounded
reading proof, not an assertion about every possible workload.

Retain the failed evidence too: before the QueryClient fix, switching to production alone was
insufficient. A second reading attempt failed after 34 requests with truncated HTTP output and
a JS heap OOM near 512 MiB. An earlier diagnostic inspector cleanup also caused a native abort
and automatic recovery. Those attempts are not stability successes. Private heap snapshots and
full local receipts remain outside Git; only these aggregate findings are shared here.

A full disposable Compose smoke on the earlier healthcheck commit `3f6993637` completed with
command/cleanup exit 0 and peak disk growth 3,876,634,624 bytes, below 8 GiB. Final-head smoke
and CI must be refreshed after the QueryClient change before delivery.
