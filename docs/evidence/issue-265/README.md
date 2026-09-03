# Issue 265 — Workshop evaluator macOS arm64 smoke

Captured from clean implementation commit `0c91b77cc17677199c466a09e52aec9df232e7f6` on 2026-09-03
after the shared contract and Go race checks passed. The evidence-only commit containing this record
does not change the tested evaluator source.

Host and runtime:

- macOS `26.5.2`, native `arm64`;
- Go `1.26.4 darwin/arm64`;
- Docker Engine `29.1.3`;
- Docker Compose `2.40.3-desktop.1`.

The native evaluator and smoke driver were built from that clean source tree, then executed with:

```bash
evaluator_version="$(./dist/workshop-evaluator --version)" && ./dist/workshop-evaluator-smoke --binary ./dist/workshop-evaluator --version "$evaluator_version" --real-compose
```

Result:

```text
Native evaluator smoke passed on darwin/arm64 with one schema-valid report and bounded cleanup.
```

The tested `workshop-evaluator` was version `0.1.0-beta.1` with SHA-256
`f5f9327e2fe33954aa955228ea9766a1ef7790801c6175e5b9c5c501169ef5f0`.

The smoke used a digest-pinned synthetic container, read its participant fixture through the
read-only repository mount, completed the versioned device/report exchange, accepted exactly one
schema-valid report, and found no Compose containers after cleanup. Linux amd64 and Windows amd64
real-host evidence is produced by `.github/workflows/workshop-evaluator.yml`.
