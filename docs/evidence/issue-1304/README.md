# Local stand budget evidence — #1304

These are read-only measurements from 9 October 2026 UTC / 10 October 2026 MSK. Exact capture instants and
checksums are in [capture-metadata.json](capture-metadata.json). No local Docker build, pull,
Compose or live-stand operation ran. Actual peak build growth and successful standard startup are
**pending** a sole-heavy slot and Content's ownership handoff.

## Inputs and sources

| Input | Source | Observation |
|---|---|---|
| Candidate root context before adding these evidence artifacts |[context-candidate.json](context-candidate.json), upstream Moby patternmatcher v0.6.1|163,513,996 bytes;5,396 files; reports: 0|
| Same untouched primary with candidate exclusions |native Moby probe, full diagnostic source/artifacts kept in `.reports/1304`|164,586,962 bytes;5,428 files; reports: 0|
| Retained Next build snapshots |[cache-next-build.txt](cache-next-build.txt)|9 records; maximum 447.8 MB|
| Retained frozen workspace-install snapshots |[cache-workspace-install.txt](cache-workspace-install.txt)|29 records; maximum 2.261 GB|
| Existing backend layers |[API history](inside-platform-api_latest-history.txt)|install 1.83 GB; old source COPY 2.22 GB|
| Existing production web layers |[web history](inside-platform-web_latest-history.txt)|payload copies 84.8 MB+3.61 MB+8.59 MB|
| CLI-reported complete web image size |[web image size](inside-platform-web_latest-size.txt)|374 MB; same image ID 539922ada175 as the history capture|

The two context counts describe different trees: the unchanged primary checkout and the task
worktree with its own branch/local file set. Later evidence artifacts add only kilobytes;165 MB
remains the planning envelope, not a claimed final build byte count.

Image-history captures print only IDs/sizes, not `CreatedBy` or environment. Cache captures print
only IDs/sizes/Shared. Shared cache records overlap: adding every record does not measure physical
storage. Docker inspect's compressed `Size` also does not measure peak unpack storage. The CLI-reported
complete image size is retained separately from individual history-layer sizes; neither is a
measurement of future growth.

Capture commands:

```bash
docker image history --format '{{.ID}} {{.Size}}' inside-platform-api:latest
docker image history --format '{{.ID}} {{.Size}}' inside-platform-web:latest
docker image ls inside-platform-web:latest --format '{{.ID}} {{.Size}}'
docker buildx du --filter 'description~="pnpm --filter @inside/web build"' --format '{{.ID}} {{.Size}} {{.Shared}}'
docker buildx du --filter 'description~="pnpm install --frozen-lockfile"' --format '{{.ID}} {{.Size}} {{.Shared}}'
```

The native context probe uses upstream Moby `ignorefile` and `patternmatcher.MatchesOrParentMatches`,
walks filesystem metadata without reading source/credential contents, and refuses included reports.
Its diagnostic Go source and `go.sum` remain in `.reports/1304/context-probe`. It is not a stand
runtime dependency. The bounded [scratch COPY smoke](../../../scripts/local-build-context-smoke.sh)
is the repository's actual Docker regression proof; it has not run locally yet.

## Planning model

Docker's GB/MB are decimal; GiB are binary. This is a conservative **estimate**, not measured future
consumption. All ten backend roles now export one shared image, and the four application/infrastructure
builds run sequentially.

| Possible new storage | Calculation | GiB |
|---|---|---:|
| backend/web source cache and unpack |4*165 MB|0.615|
| Next workspace/temporary result |2*447.8 MB|0.834|
| final web/export payload (includes already cached base) |2*374 MB|0.697|
| export metadata/new data directory/variation |modeling headroom|0.5|
| warm subtotal |round up 2.646 GiB|3|
| two possible dependency-key misses |2*2.261 GB|4.211|
| ceiling |round up 7.211 GiB|8|

Logto and RabbitMQ source inputs are unchanged by #1304, with existing images retained. Workspace
versions, lockfile and application sources are unchanged. After #1306 merges, verify the preserved
content digests before using this estimate. Cold caches or changed inputs may exceed it and stop.

The coordinator accepted the future #1304 sole-heavy proof with start free >= 20 GiB, growth ceiling 8 GiB
and floor 10 GiB. The extra 2 GiB provides stop/cleanup headroom. Monitor the actual Docker-storage host
filesystem continuously. If growth 8 GiB or floor 10 GiB is reached, stop the owned command, clean only
owned resources and restore the authorized cached stand. Do not prune other sessions' caches or data.
This acceptance does not grant the heavy slot or stand ownership. Other executors retain their 5 GiB
heavy ceiling.

## Pending verification

Record actual cache hits/misses, peak growth and ending free space. Run bounded scratch COPY,
effective Compose plan, guarded disposable smoke and both standard local-stand modes. Verify
identity, volumes, Material IDs, grants and progress before/after. The final `pnpm check`, independent
review and current-head CI remain completion requirements. Keep the owner's shared stand alive.
