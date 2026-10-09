# Local stand budget evidence — #1304

These are read-only measurements from9October2026 UTC /10October2026 MSK. Exact capture instants and
checksums are in [capture-metadata.json](capture-metadata.json). No local Docker build, pull,
Compose or live-stand operation ran. Actual peak build growth and successful standard startup are
**pending** a sole-heavy slot and Content's ownership handoff.

## Inputs and sources

| Input | Source | Observation |
|---|---|---|
| Current candidate root context |[context-candidate.json](context-candidate.json), upstream Moby patternmatcher v0.6.1|163,513,996bytes;5,396files; reports0|
| Same untouched primary with candidate exclusions |native Moby probe, full diagnostic source/artifacts kept in `.reports/1304`|164,586,962bytes;5,428files; reports0|
| Retained Next build snapshots |[cache-next-build.txt](cache-next-build.txt)|9records; maximum447.8MB|
| Retained frozen workspace-install snapshots |[cache-workspace-install.txt](cache-workspace-install.txt)|29records; maximum2.261GB|
| Existing backend layers |[API history](inside-platform-api_latest-history.txt)|install1.83GB; old source COPY2.22GB|
| Existing production web layers |[web history](inside-platform-web_latest-history.txt)|payload copies84.8MB+3.61MB+8.59MB; total existing image374MB|

Image-history captures print only IDs/sizes, not `CreatedBy` or environment. Cache captures print
only IDs/sizes/Shared. Shared cache records overlap: adding every record does not measure physical
storage. Docker inspect's compressed `Size` also does not measure peak unpack storage.

Capture commands:

```bash
docker image history --format '{{.ID}} {{.Size}}' inside-platform-api:latest
docker image history --format '{{.ID}} {{.Size}}' inside-platform-web:latest
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
| backend/web source cache and unpack |4*165MB|0.615|
| Next workspace/temporary result |2*447.8MB|0.834|
| final web/export payload (includes already cached base) |2*374MB|0.697|
| export metadata/new data directory/variation |modeling headroom|0.5|
| warm subtotal |round up2.646GiB|3|
| two possible dependency-key misses |2*2.261GB|4.211|
| ceiling |round up7.211GiB|8|

Logto and RabbitMQ source inputs are unchanged by #1304, with existing images retained. Workspace
versions, lockfile and application sources are unchanged. After #1306 merges, verify the preserved
content digests before using this estimate. Cold caches or changed inputs may exceed it and stop.

The coordinator accepted the future #1304 sole-heavy proof with start free>=20GiB, growth ceiling8GiB
and floor10GiB. The extra2GiB provides stop/cleanup headroom. Monitor the actual Docker-storage host
filesystem continuously. If growth8GiB or floor10GiB is reached, stop the owned command, clean only
owned resources and restore the authorized cached stand. Do not prune other sessions' caches or data.
This acceptance does not grant the heavy slot or stand ownership. Other executors retain their5GiB
heavy ceiling.

## Pending verification

Record actual cache hits/misses, peak growth and ending free space. Run bounded scratch COPY,
effective Compose plan, guarded disposable smoke and both standard local-stand modes. Verify
identity, volumes, Material IDs, grants and progress before/after. The final `pnpm check`, independent
review and current-head CI remain completion requirements. Keep the owner's shared stand alive.
