# Dependency update policy

Platform tracks the latest supported production-stable toolchain, not Current, preview or nightly
releases. Every package, runtime and upstream container image uses an explicit version. Platform
Dockerfiles and Compose files use readable version tags for upstream images. Application image
publication and immutable release identity are intentionally absent from the current teaching
baseline and will be introduced by the CI/CD course. The isolated Logto proof keeps its own
digest-pinned provenance contract.

## Automated updates

Dependabot checks the pnpm workspace, Docker sources and GitHub Actions weekly. Patch and minor
updates are grouped, with Next, Tiptap, Storybook and React families kept atomic. Major updates stay
in separate pull requests. Security patch/minor updates use their own groups; security majors are
also separate pull requests. No dependency pull request is auto-merged. Until the CI/CD course
restores application CI, its complete gate is run manually and the change remains owner-controlled.

`@types/node` stays on the same major as `.node-version`. A Node LTS major change updates the
runtime, declarations, Docker base and CI as one reviewed migration.

Repository dependency changes preserve:

- exact manifest pins and one `pnpm-lock.yaml`;
- explicit non-`latest` image tags for upstream Platform runtime dependencies;
- `minimumReleaseAge: 1440` supply-chain quarantine;
- strict peer dependencies without overrides;
- atomic package-family updates;
- `pnpm check:full`, Docker image/config checks and the Compose clean/repeat/watch smoke.

## Current baseline

Node `24.19.0` is the latest production LTS; Node 26 is Current and is not the production baseline.
The status and production recommendation come from the
[official Node.js release table](https://nodejs.org/en/about/previous-releases).

TypeScript is pinned to `7.0.2` in the root, backend and web manifests. There is no compatibility
alias or second compiler. The canonical proof is:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm list -r typescript --depth 30
```

The list must report one installed version, `7.0.2`. Next uses its TypeScript CLI path, lint uses
Oxlint's native type-aware engine, and architecture scripts use `oxc-parser`; no tool imports the
removed TypeScript JavaScript API. OpenAPI generation uses `openapi-typescript-codegen`, whose
template implementation has no TypeScript dependency. Storybook uses `@storybook/react-vite` and
`react-docgen`, so its active build path also avoids the compiler API.

Keep strict peer dependencies enabled and do not add peer overrides to force an incompatible tool
onto TypeScript 7. A dependency that requires the removed API must be replaced, disabled until it
publishes a compatible stable release, or rejected. In particular, the Storybook MCP add-on remains
out of the baseline until its stable dependency graph installs without an override.

## Oxlint coverage boundaries

Oxlint natively owns strict TypeScript rules, React hooks/compiler rules, Next rules, import
boundaries and the backend exhaustive-switch negative fixture. The removed JavaScript plugins have
these explicit replacements:

- TanStack Query factories keep typed `queryOptions`/`infiniteQueryOptions`, request-isolated server
  clients and one browser singleton. Focused query/hydration tests plus route E2E own behaviour that
  used to receive additional syntax-only plugin checks.
- Storybook's browser project runs every story interaction and configured accessibility check;
  `pnpm test:storybook` and `pnpm build:storybook` replace the plugin's static story conventions.
- Next navigation uses native Oxlint rules and production `next/link`; Playwright owns route
  behaviour that has no native equivalent rule.

The residual risk is limited to authoring conventions that those JavaScript plugins could flag
before execution. Do not add an ESLint compatibility runner for that gap. Prefer a native Oxlint
rule when one becomes stable; otherwise add a typed API constraint or a focused executable test for
a demonstrated regression.

pnpm remains at `11.22.0` until a separately verified stable update passes frozen installation and
the full repository gate. Do not weaken `strictPeerDependencies` to accept a package-family update.
