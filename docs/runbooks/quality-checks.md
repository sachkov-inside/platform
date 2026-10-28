# Quality checks

`pnpm check:static` includes `pnpm quality:check`: real positive/negative tool proofs,
workflow lint, shell lint, Dockerfile lint, dependency usage and the shared Storybook MCP endpoint.
`pnpm quality:security` separately checks source secrets and production dependency advisories.
Application CI requires security for every candidate, including documentation-only changes.
Its failed, cancelled, missing or skipped result prevents `CI Gate` success.

## Commands and boundaries

| Command | Blocking result and scope |
|---|---|
| `pnpm quality:proof` | Correct synthetic input passes and known violations exit 1 in Betterleaks, jactionlint, ShellCheck, Hadolint and Knip. Secrets proofs exercise untracked tokens, report-name collisions, clean commit history, a key introduced then removed and an unavailable history base |
| `pnpm quality:secrets` | Betterleaks medium/high-confidence findings fail. Scans tracked regular files plus non-ignored new files, with redaction, no live validation and no inline allow comments. Local ignored credentials and external symlink targets never enter the temporary snapshot |
| `pnpm quality:audit` | `pnpm audit --prod --audit-level=moderate`; advisories and registry/process failures remain failures. No automatic fixes or registry-error bypass |
| `pnpm quality:workflows` | jactionlint default profile, strict exit, offline checks of workflows, composite actions and Dependabot. Workflow ShellCheck checks warning/error levels. Expiring, scoped exceptions are in `.github/jactionlint.yaml` |
| `pnpm quality:shell` | ShellCheck on repository shell scripts and hooks, including informational/style diagnostics. Imported skills and negative fixtures keep their source bytes |
| `pnpm quality:docker` | Hadolint warnings/errors fail. Informational findings remain visible. File-specific upstream/package-install exceptions are in `scripts/quality-check.mjs`; Docker runtime/image/provenance contracts remain required |
| `pnpm quality:unused` | Knip checks unused and undeclared dependencies with explicit workspace entries. Guardrail fixtures and generated outputs are excluded. Prisma's generated runtime requires the explicit `@prisma/client` exception in `knip.json` |
| `pnpm quality:agents` | JSON shape and agreement of the Storybook MCP URL in `.mcp.json` and `.codex/config.toml`; not a complete Codex TOML validator |

The pinned external binaries and archive SHA-256 digests for macOS/Linux, arm64/x64, live in
`scripts/quality-tools.json`. First use downloads only those assets into the worktree's
`node_modules/.cache/quality-tools`; subsequent uses verify cached bytes again and extract a fresh
temporary executable. A mismatch, unsupported platform, download/extraction error or process timeout
fails. No global tool installation is needed. Frozen pnpm installs Knip alongside the existing tools.

Secret findings print only rule, path and line. Reports and source snapshots are temporary and
are removed after the scan; no findings artifact is uploaded. The deliberate invalid release archive
fixture is excluded from the snapshot. Betterleaks' built-in binary/vendor/lockfile exclusions apply.
`.betterleaks.toml` accepts explicit public local/smoke credential values and `replace-with-...`
placeholders, without excluding test directories. Low-confidence generic matches are not blocking.
Tool proofs verify that a provider-shaped key still fails with this configuration.

The tracking/waitlist storage proof also uses one public disposable PostgreSQL identity.
Its exceptions require the exact credential value, rule and repository-relative source file;
URI findings additionally require the complete fixed loopback endpoint. Snapshot scans run
from their isolated source directory so nested lookalike paths cannot inherit an exception.
CLI proofs retain rejection of other credentials, endpoints, nested paths and provider keys,
and exercise accepted and rejected credentials after their removal from Git history.

Root proof scripts consume PostgreSQL/Fastify from Backend and the TypeScript loader from
Telegram. Root development dependencies declare those consumers at the application owners'
exact versions; the proof contract checks both manifest equality and installed resolution.
The existing application-relative runtime loading paths and production dependencies remain
owned by their application manifests.

PR/queue security also scans the candidate's new commit history from `QUALITY_BASE_SHA`; the
value must be a full SHA. Scheduled/release runs scan the current source snapshot, not the entire
historical repository. The daily `.github/workflows/security.yml` detects newly published advisories
and expired workflow exceptions even when no code changes. Provider credentials are never validated
against live APIs. A scanner processing error is distinct from a clean scan.

## Existing checks strengthened

`pnpm docs:check` now includes local links and anchors in product documents, specifications and ADRs,
in addition to instructions, root entry documents and runbooks. Historical research/evidence are not
silently promoted to current instructions. It does not check remote HTTP links.

The existing Web Oxlint configuration adds selected static accessibility rules.
Web guardrails also run `pnpm lint:cycles` over Web app/src with explicit Oxlint graph flags;
negative cycle fixtures verify the actual invocation.
Composite widgets still rely on their keyboard/axe browser tests; generic click/focus rules produced
false positives for valid delegated and `aria-activedescendant` interactions. Backend/Telegram Module
cycle rules remain unchanged. The intentional recursive MaterialBody schema graph is not subjected
to a second package-cycle gate.

Telegram guardrails retain the first 39 shipped migration files by their ordered content identity.
Appending a later migration passes; changing, removing or renaming a historical file fails. Updating
the current release identity does not update this historical prefix. Backend retains its existing
checksum ledger and historical-prefix tests. Neither check establishes migration lock safety.

Production navigation tests now enforce uncompressed payload budgets at their existing checkpoints:
1,100,000 bytes for the 120-Material programme Flight response and 1,500,000 bytes for film script
responses. On 28.10.2026, Next 16.4.1 desktop/mobile Chromium measured 927,610 and up to 1,276,051
bytes respectively; rounded limits retain approximately 18% headroom. These guard against regressions,
not universal performance targets or compressed transfer sizes. The thresholds and rejection behavior
are owned by `apps/web/test/support/payload-budgets.ts` and its focused tests.

## Adoption decisions

The comparison source is [dev-quality-gates commit d6e1b48](https://github.com/mokevnin/dev-quality-gates/tree/d6e1b48bf25c6e758ff2ca457315dd07f22a8df8),
specifically its Recommendations, `tools.json` limitations and adoption patterns. Existing project
contracts retain priority. These choices implement #1770:

- Keep Oxlint/Prettier, pnpm, hooks and Dependabot. Replacing them with ESLint/Biome/oxfmt,
  mise/hk or Renovate would add migration work without closing an identified gap.
- Knip 6.43.0 supports this TS7 workspace without importing the removed compiler API. Its default
  trial reported 266 unused files and over 1,000 export/type findings, including intentional entrypoints
  and protocol interfaces. Start with dependency usage; no mass deletion, autofix or export baseline.
- Do not add dependency-cruiser while native Web file-cycle and existing Module checks cover the
  chosen scope. Dynamic runtime edges remain a review responsibility.
- Keep generated OpenAPI/client/MCP/protocol byte checks. oasdiff needs a separately chosen published
  compatibility baseline and consumer policy; current drift checks and protocol corpora remain required.
- Defer squawk until SQL extraction from TypeScript/Kysely migrations preserves the executed SQL.
  Running it directly on `.ts` would not prove safety. No SQL formatter migration is included.
- Do not impose an arbitrary coverage percentage or install diff-cover without trustworthy reports.
  Positive/negative checks of the newly added gates provide the focused behavioral evidence here.
- Do not replace project routing checks with agnix or move existing guards to ast-grep/Conftest.
  The narrow MCP contract covers the observed configuration seam.
- No general Markdown formatter, Russian spell checker or remote-link network gate is introduced.
  Expanded local reference checking addresses the reproduced documentation defects.
- Container OS-package vulnerability scanning remains separate. pnpm audit and Hadolint do not
  cover it; no scanner was selected from the source's under-review candidates.

Security dependency updates in this change keep the existing majors: Next, Zod, Undici and Nodemailer,
plus compatible transitive fixes. They require ordinary application/browser verification; no release
or production deployment is implied by this tooling change.

Next 16.4.1 also changes how a static App Shell can be delivered. Navigation test observers accept
both completed RuntimeShell responses and completed static page segments. Route trees, layout
segments and per-link PPR data do not satisfy that barrier. The shared classifier and its negative
cases live in `apps/web/test/support/app-shell-prefetch.ts`; user-visible navigation, payload and
private-data assertions remain required. Storybook imports the same read-only search-params class
from Next's shared leaf module to avoid importing server rendering internals into the browser.
