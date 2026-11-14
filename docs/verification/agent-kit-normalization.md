# Agent Kit normalization evidence

## Scope and acceptance

Normalize all existing common engineering/procedure variants in Platform to selected pinned
Agent Kit copies. Preserve project starts, autonomy, worktree mode, testing seams, commit/review
order, tracker, owner gates, sensitive zones, CI and merge queue. Keep all nonselected skill folders
and application/provider/content materials unchanged. Preserve complete folders, modes, native
metadata, attribution, notices and runtime discovery without Home or sibling clones.

Starting commit: `492636dd8660b44a028f0358ad9d7b86302ab9b9` (fetched `origin/main`).
The owned branch is `chore/skills-normalization`.
Selected source: `b1608ac14d8f934a8686a0c583f1110466a18b18` in
[Agent Kit](https://github.com/KirillSachkov/agent-kit/tree/b1608ac14d8f934a8686a0c583f1110466a18b18).
The complete 25-name selection and update route are in
[AGENT-KIT.md](../../.agents/skills/AGENT-KIT.md).

## Reconciliation

Nine previously managed selections update normally. Sixteen unmanaged variants were compared
against the public source over complete folders, including references and executable modes.
Before adoption, checkout bytes/modes matched their exact tracked folders at the starting commit.
A private temporary catalog used that immutable commit and those source paths for explicit
canonical-engine adoption. Final selection, preview, install and check use only the public
provider; neither manifest nor lock retains temporary consumer entries or private paths.
Raw originals and installer backups with matching locks stay ignored, outside committed evidence.

| Previous inherited requirement | Current project authority |
|---|---|
| Explicit assignment, no-ticket criteria, TDD where possible, accepted seams, agent routine test choice | [Implementation](../agents/implementation.md) and root AGENTS.md |
| Typechecks/focused tests during product work, final applicable verification level | [Implementation](../agents/implementation.md), root AGENTS.md Commands |
| Commit before independent Standards/Spec review, correction review, then ship | [Implementation](../agents/implementation.md) |
| Door/Zone/Proof, always-sensitive zones, exact-result acceptance | [Ship](../agents/ship.md#owner-acceptance) |
| Target-branch gate authority, CI Gate, merge queue, permission and advance acceptance | [Implementation](../agents/implementation.md), [Ship](../agents/ship.md) |
| One integration branch/final PR for a whole spec, fresh workers and full integration review | [Coordinated execution](../agents/coordinated-execution.md) |
| Localized PR shape and risk/presentation pointers | [PR body](../agents/pr.md) |
| Storybook prototype route, fixtures and owner visual gates | Existing [frontend delivery](../agents/frontend-delivery.md) |
| GitHub, labels, glossary/ADR placement, correction handling | Existing [issue tracker](../agents/issue-tracker.md), [triage labels](../agents/triage-labels.md), [domain](../agents/domain.md), [owner corrections](../agents/owner-corrections.md) |

`ask-matt` was already excluded. Its renamed `ask` successor stays excluded; there is no orphaned
caller or alias to install. The existing subset remains 25 skills, rather than the whole library.

The first proposed source, `257dd644eb338442e86237532cfe38bd74ba532e`, regressed the existing wizard's
safe dotenv writes. Delivery paused and the gap went upstream. The accepted source above restores
those protections and fixes assignment when the caller's variable name collides with helper locals.
No local fork of the shared procedure remains.

## Preserved folders

The following SHA-256 values match both preflight and final reconciliation. The canonical
installer digest covers sorted relative paths, Git executable modes and bytes of each whole
folder. These are content identities, not assertions of skill correctness.

| Nonselected skill | Preflight and final SHA-256 |
|---|---|
| `ai-models-refresh` | `d6c9c2e760e554a17f32fbef4e9ed6ac3db6923ef7a7893f1a1003b455e79f41` |
| `impeccable` | `6f6b8af1d163a6b2b88e44fc31ee541c31caf050972785dac5a61d3a7b79674f` |
| `local-stand` | `7e22d03b5c115ca94b6ead136b9b7039c9692339ee3c9ee5864222cca8949bab` |
| `modern-web-guidance` | `526692d9b9f2931a3020badc955d2127ab2bb702669231c72393aadf4e772ffc` |
| `playwright-cli` | `7ef1439466aaddee892436e6b4a8cb2c408bce477f795b9eb4490a0e309076bd` |
| `session-cleanup` | `a3bcf6da87749f27bb4a896834661c6d47be89ff87860b8e3843a38a73edda2e` |
| `vercel-react-best-practices` | `237a6de4febe7b96179d83aa24256429d7c0cfe6d1ee5a4fd8ff28ca01322dc7` |

## Verification boundary

Canonical installer `check` proves selected source/lock identity. Local Markdown-link validation
checks relative file destinations outside fenced examples; the Claude alias resolves to the
same project-local `.agents/skills` index used by Codex. `pnpm docs:check` validates the project
documentation contracts. The PR records delivered commit/tree, independent review and current CI;
these folder identities do not replace that review or owner acceptance.
