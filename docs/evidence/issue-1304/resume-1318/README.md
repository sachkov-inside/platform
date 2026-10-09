# Budget refresh after main391 / linked #1318 — 10 October 2026

Actual build growth and successful normal startup remain **PENDING**. The separate root sole-heavy
signal has not been given. Content transferred singleton to root at 2026-10-09T23:11:40Z, but root
still holds runtime permission during this LIGHT phase. No build/pull/up/down/restart/migration ran.

## Dated read-only inputs

[capture-metadata.json](capture-metadata.json) records the command, time and SHA-256 of every capture.
The original [receipts/model](../README.md) remain unchanged as historical inputs.

| Input | Source | Measured metadata |
|---|---|---|
| Candidate after ordinary main391 merge and CSP/margin source fixes, before this model prose |[native Moby enumeration](context-input.json)|163,582,311 bytes; 5,413 files; reports 0|
| Retained Next build snapshots |[cache-next-build.txt](cache-next-build.txt)|9 records; maximum 447.8 MB|
| Retained workspace install snapshots |[cache-workspace-install.txt](cache-workspace-install.txt)|29 records; maximum 2.261 GB|
| CLI complete image size |[web-image-size.txt](web-image-size.txt)|374 MB; same cached image539922ada175|

The source envelope remains165 MB. Later model prose adds only kilobytes; final context enumeration
is also retained in the writing owner's local handoff. This table names its historical capture
scope rather than asserting final Docker transfer bytes. Retained cache records overlap; these
sizes are neither physical host growth nor a future build peak.

## Changed inputs and estimate

Ordinary merge dependency:3917205c7d792f79d7f0a5bd6a319999221ce346. #1306 acquisition refs stay on
ECR Public with their pinned versions/digests. [Its verified manifest evidence](../../issue-1306/official-image-manifests.json)
records equal upstream content identities. The [input-change receipt](input-change-receipt.json)
compares pinned refs and dependency source hashes with main391. Workspace versions/lockfile and
dependency-stage package inputs did not change. Registry metadata resolution remains part of the future authorized build;
no pull or registry acquisition ran here.

#1318 adds the existing validated CSP ARG only after `FROM development AS production-build`, before
`next build`. It must invalidate that Next result for the configured origin. It does not introduce
a dependency-install input or widen default release CSP. API/MCP signed URLs in the local learner
overlay now follow the same published storage port. These source changes invalidate COPY caches;
they remain within the measured165 MB planning envelope. Cache hits are not assumed.

| Possible new storage | Conservative allocation | GiB |
|---|---|---:|
| Backend/web source cache and unpack |4×165 MB|0.615|
| Next workspace/temporary result, including the changed local CSP build |2×447.8 MB|0.834|
| Web final/export, including already cached base |2×374 MB|0.697|
| Metadata/new data directory/variation |model headroom, not measured|0.5|
| Warm subtotal |round up2.646 GiB|3|
| Two possible backend/web install cache-key misses, including acquisition ref changes |2×2.261 GB|4.211|
| Estimated envelope |round up7.211 GiB|8|

Docker MB/GB are decimal; GiB are binary. This is the same provisional model, recalculated against
refreshed inputs. Cold cache or changed dependency inputs may exceed it and stop safely. An8 GiB
ceiling is a bound for the future proof, not evidence that it can succeed.

Admission remains free>=20 GiB; ceiling8 GiB; mandatory floor10 GiB. The new approved stop margin
is256 MiB: command supervision starts stopping at growth>=7.75 GiB or free<=10.25 GiB. The full
ceiling/floor are unchanged; the2 GiB admission headroom is retained. Sampling remains every250 ms.
Future proof must measure actual peak and ending free through the complete owned window, including
cleanup/restoration. Per-launch monitoring does not replace that whole-window measurement.

## Acceptance still pending

Bounded real scratch COPY, normal development and production-web build/startup, actual baked header,
protected image render plus anonymous denial, current FULL course/data/identity preservation,
guarded disposable smoke, final `pnpm check` and current-head CI. Do not restore old09October dumps
over the newly imported course or technical submissions. Cached-runtime restoration preserves
current volumes/data. Content resumes its genuine133-asset browser delivery after the exact runtime
handoff; metadata/source/config green is not that browser proof.
