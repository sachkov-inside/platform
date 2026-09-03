# Workshop evaluator

The Workshop evaluator is a pinned native CLI. It validates `.inside/assignment.json`, proves the
local Git/host/Docker preconditions, obtains a one-time report token through the device protocol,
downloads the exact case evaluator bundle, runs its bounded Compose topology, and submits one
schema-valid report.

The accepted application boundary is recorded in
[ADR 0014](../../docs/adr/0014-pinned-native-go-workshop-evaluator.md).

The first beta target matrix is:

- `darwin/arm64`;
- `linux/amd64`;
- `windows/amd64`.

The evaluator never auto-updates and stores no Logto cookie, GitHub credential, device code, or
report token. Assignment manifests and bundle digests are exact-version bindings, not authority for
Platform source capture. Before downloading or executing a bundle, the device response must return
the exact SHA-256 of the local manifest approved for that Assignment; editing the manifest therefore
fails before participant code can run unless the edit changes only insignificant JSON formatting.
Compose receives a temporary detached Git worktree at the verified pushed commit. Tracked files are
materialized directly from Git blobs without checkout hooks or content filters, so dirty files,
untracked files, and later working-tree edits cannot enter the evaluation. Symlinks and submodules
fail closed because they cannot be represented consistently across all three beta hosts.

From the repository root:

```bash
pnpm workshop:evaluator:generate
pnpm workshop:evaluator:test
```

`workshop:evaluator:generate` is required only when canonical schemas under
`contracts/workshop/` change. CI builds and executes each native artifact on its target host,
verifies its exact checksum, and uploads a checksum-addressed `tar.gz` package as one immutable
workflow artifact. Packaging preserves the executable bit required by Unix hosts. Each package
contains the native binary, its exact checksum, and the checksum-verifying wrapper for that host's
shell. From the Assignment repository root, download the matching archive and its `.sha256` file,
then run the command for the native host:

```bash
shasum -a 256 --check workshop-evaluator-darwin-arm64.tar.gz.sha256 && mkdir -p .inside/bin && tar -xzf workshop-evaluator-darwin-arm64.tar.gz -C .inside/bin && .inside/bin/run-workshop-evaluator.sh
```

```bash
sha256sum --check workshop-evaluator-linux-amd64.tar.gz.sha256 && mkdir -p .inside/bin && tar -xzf workshop-evaluator-linux-amd64.tar.gz -C .inside/bin && .inside/bin/run-workshop-evaluator.sh
```

```powershell
$archive = "workshop-evaluator-windows-amd64.tar.gz"; $expected = ((Get-Content -Raw "$archive.sha256").Trim() -split "\s+")[0].ToLowerInvariant(); if ((Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant() -ne $expected) { throw "Package checksum mismatch." }; New-Item -ItemType Directory -Force .inside/bin | Out-Null; tar -xzf $archive -C .inside/bin; & .inside/bin/run-workshop-evaluator.ps1
```

The wrapper verifies the downloaded binary checksum. The binary then requires its own exact
version to match `evaluatorVersion` in `.inside/assignment.json` before it authorizes or executes
the evaluator bundle.

The native smoke uses a deterministic fake Git adapter on every host. On Linux amd64 and Windows
amd64 CI, real Docker Compose runs a digest-pinned synthetic container that must read a fixture
through the participant repository mount. GitHub-hosted macOS arm64 runners [do not support nested
virtualization](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#limitations-for-arm64-macos-runners),
which a Docker daemon there would require, so CI still executes the native CLI with the fake Docker
adapter; release evidence must additionally include the same `--real-compose`
smoke on a physical macOS arm64 host. That real-host run, plus both CI runs, completes the
device/report contract and proves bounded cleanup on all three beta targets.
