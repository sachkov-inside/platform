# Issue 265 — Workshop evaluator macOS arm64 smoke

Captured from clean implementation commit `b898b0c929b92b92299e495b66e01c9eb213bb62` on 2026-09-03
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
`c12969dd6329218eaf2738ff951d37197531805a80b91165f2be4b7b4694f8eb`.

The smoke used a digest-pinned synthetic container, read its participant fixture through the
read-only repository mount, completed the versioned device/report exchange, accepted exactly one
schema-valid report, and found no Compose containers after cleanup. Linux amd64 and Windows amd64
real-host evidence is produced by `.github/workflows/workshop-evaluator.yml`.
