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
