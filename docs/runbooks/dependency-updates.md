# Dependency update policy

Platform tracks the latest supported production-stable toolchain, not Current, preview or nightly
releases. Every package, runtime and upstream container image uses an explicit version. The Node
base of the application Dockerfiles is pinned by tag and multi-platform digest, so a re-published
tag cannot change the next release; Compose files use readable version tags for other upstream
images. Third-party GitHub Actions are pinned by release commit SHA with the version in a comment.
The isolated Logto proof keeps its own digest-pinned provenance contract.

## Automated updates

Dependabot checks the pnpm workspace, Docker sources and GitHub Actions weekly. Patch and minor
updates are grouped, with Next, Tiptap, Storybook and React families kept atomic. Major updates stay
in separate pull requests. Security patch/minor updates use their own groups; security majors are
also separate pull requests. No dependency pull request is auto-merged. Every dependency pull
request must pass the application `CI Gate` and then the merge queue; merge remains
owner-controlled.

Dependabot does not rebase open pull requests on its own (`rebase-strategy: disabled`): the merge
queue proves each update against the current `main`, so a rebase after every merge only repeated
full CI. Comment `@dependabot rebase` when a pull request has a real conflict or needs a fresh run.
A red dependency pull request is triaged in the same weekly pass, never left to fail again: fix the
incompatibility in the pull request itself (for example regenerate a drifted contract), or close it
with the reason and `@dependabot ignore this minor version` or an `ignore` entry here. A bump of a
managed harness file (such as `.github/workflows/inside-agent-sessions.yml`) is closed here and made
in the Workspace harness package, because the next harness update would revert it.

`@types/node` stays on the same major as `.node-version`. A Node LTS major change updates the
runtime, declarations, Docker base and CI as one reviewed migration. Actions and the Node base
digest are advanced only by reviewed Dependabot pull requests, which update the SHA or digest
together with its version comment or tag. Managed harness workflows are pinned in the Workspace
package ([workspace#211](https://github.com/sachkov-inside/workspace/issues/211)).

Repository dependency changes preserve:

- exact manifest pins and one `pnpm-lock.yaml`;
- explicit non-`latest` image tags for upstream Platform runtime dependencies;
- `minimumReleaseAge: 1440` supply-chain quarantine;
- strict peer dependencies; overrides only under Security overrides below;
- atomic package-family updates;
- `pnpm check`, Docker image/config checks and the Compose clean/repeat smoke in CI;
- local `pnpm check:full` when the update can affect the browser-to-host application path.

## Security overrides

`pnpm audit --prod` stays free of moderate and higher advisories. Fix an advisory by updating the
direct dependency first. When the fix exists only in a transitive package that a parent pins
exactly, and the parent has no fixed release on our major line, `pnpm-workspace.yaml` may override
that one package to the fixed version. Each override names its parent and removal condition in a
comment, and `scripts/toolchain-contract.test.mjs` lists the allowed set, so a new override is a
reviewed change of both. Current overrides (#688):

| Package | Pinned by | Remove when |
|---|---|---|
| `fastify` | `@nestjs/platform-fastify` 11.x | Platform moves to Nest 12 (ESM) or Nest 11 ships fastify ≥ 5.12.1 |
| `mysql2` | `prisma` 7.10.0 | a stable Prisma release pins mysql2 ≥ 3.23.1 |
| `deepmerge-ts` | `@prisma/config` 7.10.0 | a stable Prisma release uses deepmerge-ts ≥ 8 |

Overrides never force a peer range onto an incompatible tool; the TypeScript 7 rule below stands.

## Current baseline

Node `24.21.0` is the latest production LTS; Node 26 is Current and is not the production baseline.
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

pnpm is pinned to `11.27.1`, the latest 11.x; pnpm 12 waits for a separately verified migration
that passes frozen installation and the full repository gate. Do not weaken
`strictPeerDependencies` to accept a package-family update.
