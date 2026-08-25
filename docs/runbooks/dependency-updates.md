# Dependency update policy

Platform tracks the latest supported production-stable toolchain, not Current, preview or nightly
releases. Every package, runtime and image uses an exact version; container images additionally use
an immutable multi-platform digest, and GitHub Actions use a commit SHA with a release comment.

## Automated updates

Dependabot checks the pnpm workspace, Docker sources and GitHub Actions weekly. Patch and minor
updates are grouped, with Next, Tiptap, Storybook and React families kept atomic. Major updates stay
in separate pull requests. Security patch/minor updates use their own groups; security majors are
also separate pull requests. No dependency pull request is auto-merged: every one runs the complete
pull-request CI and remains owner-controlled.

`@types/node` stays on the same major as `.node-version`. A Node LTS major change updates the
runtime, declarations, Docker base and CI as one reviewed migration.

Repository dependency changes preserve:

- exact manifest pins and one `pnpm-lock.yaml`;
- `minimumReleaseAge: 1440` supply-chain quarantine;
- strict peer dependencies without overrides;
- atomic package-family updates;
- `pnpm check:full`, Docker image/config checks and the Compose clean/repeat/watch smoke.

## Current baseline and compatibility holds

Node `24.19.0` is the latest production LTS; Node 26 is Current and is not the production baseline.
The status and production recommendation come from the
[official Node.js release table](https://nodejs.org/en/about/previous-releases).

TypeScript stays at `6.0.3`. The checked-in proof is reproducible:

```bash
bash scripts/prove-typescript-7.sh
bash scripts/prove-typescript-7.sh --with-alias-check
```

The first command runs the exact TypeScript `7.0.2` CLI over every repository tsconfig after Next
type generation and requires the branded-ID negative fixture to retain diagnostic `TS2322`. That
project-source corpus covers backend source/build/tests and Vitest configs, Nest decorators,
Kysely generated types, Next generated types, Storybook TypeScript config/stories, and Playwright
config/specs. It then explicitly disables `skipLibCheck` and requires the known declaration
failures to remain visible: the backend's DOM-free config exposes Tiptap, ProseMirror and Vitest
browser DOM declarations, while web exposes Storybook, Radix and `ast-types` incompatibilities
(plus generated Next conflicts when both development and production corpora exist). Canonical
TypeScript 6 shares part of this third-party declaration debt, so only the project-source TS7 pass
is claimed.

TypeScript itself does not parse MDX. MDX, Storybook runtime/build, Vitest, Playwright and Kysely
code generation therefore require the package-level side-by-side contract rather than a CLI-only
claim.

The second command reproduces that official TypeScript 7 CLI/TypeScript 6 API alias in a disposable
workspace. Strict dependency installation fails before those tool integrations can run, so they are
explicitly **blocked**, not reported as TypeScript 7 passes. On this small repository the measured
sequential CLI proof was `3.86s`; the warm canonical TypeScript 6 workspace typecheck was `1.61s`,
so there is no current end-to-end speed win.

More importantly, TypeScript 7 has no stable programmatic API until 7.1. The
[official TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
recommends a TypeScript 6 compatibility alias for tools such as ESLint, while
[`typescript-eslint` supports only TypeScript `<6.1`](https://typescript-eslint.io/users/dependency-versions/).
In this repository that disposable alias proof cannot regenerate the strict pnpm lockfile: the current
Storybook/Next/Vite chain includes `tsconfck@3.1.6`, whose TypeScript peer is `^5.0.0`, and the
Storybook MCP chain also resolves `@valibot/to-json-schema@1.7.1` beside `valibot@1.2.0` although it
requires `^1.4.0`. Unsupported peer overrides are deliberately not used.

Retry TypeScript 7 when all of these are true:

1. the stable TypeScript API is supported by `typescript-eslint`;
2. Storybook/MDX and its Next/Vite chain publish a compatible peer contract;
3. the official side-by-side alias, if still needed, passes strict frozen installation;
4. project and library diagnostics are reviewed without adding new skips, and canonical and
   compatibility diagnostics, Next typegen, Storybook, Vitest, Playwright, Kysely generated types
   and architecture fixtures all agree under the full gate.

pnpm remains at `11.22.0` for the same reproducible lock-refresh reason: `11.23.0` turns those
existing transitive peer mismatches into a strict installation failure. Retry the pnpm minor after
the Storybook peer chain is compatible; do not weaken `strictPeerDependencies`.
