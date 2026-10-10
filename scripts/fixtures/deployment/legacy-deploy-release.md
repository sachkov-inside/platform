# Legacy deploy-release fixture

`legacy-deploy-release` is the unmodified script from `origin/main` at
`059590557aa49e638e9863c1f1825c2f0b9cbc62`, captured for #1285 on 09.10.2026.
SHA-256: `214d4d68329f02e5a43d4d63f35e598f6354e3e5efead25af2c8cddbaab72a70`.

The deployment contract packs this snapshot into the v1 runtime bundle and selects it through
the real host gateway for rollback. Its strict operation-journal validation must reject the
incompatible embedded maintenance field, accept the new closed journal, and retain its existing
unfinished-operation restriction. Do not update this snapshot when main changes: it proves the
immutable old target script, without requiring Git history or a moving ref in CI.
