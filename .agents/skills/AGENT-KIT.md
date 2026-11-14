# Selected Agent Kit skills

Shared source: [KirillSachkov/agent-kit](https://github.com/KirillSachkov/agent-kit/tree/b1608ac14d8f934a8686a0c583f1110466a18b18),
commit `b1608ac14d8f934a8686a0c583f1110466a18b18`. The [manifest](../skills-manifest.json) selects the existing 25 engineering
skills; the [lock](../skills-lock.json) records whole-folder identities, including notices.

Selected skills: `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `grill-with-docs`, `grilling`, `handoff`, `implement`, `implement-spec`, `improve-codebase-architecture`, `pr`, `prototype`, `research`, `retro`, `setup-matt-pocock-skills`, `ship`, `tdd`, `to-questionnaire`, `to-spec`, `to-tickets`, `triage`, `wait-what`, `wayfinder`, `wizard`, `writing-for-agents`.

## Project ownership

Portable procedures come from pinned Agent Kit copies. Root [AGENTS.md](../../AGENTS.md) and
[project contracts](../../docs/agents/implementation.md) own starts, worktree mode, testing seams,
commit-before-review order and delivery. [Ship](../../docs/agents/ship.md) owns baseline sensitive
zones, Door/Zone/Proof acceptance, merge permission, CI Gate and merge queue policy. Tracker,
frontend, domain and owner-correction contracts keep their existing owners.

Unselected folders retain project/package ownership: `ai-models-refresh`, `impeccable`,
`local-stand`, `modern-web-guidance`, `playwright-cli`, `session-cleanup` and
`vercel-react-best-practices`. Their complete folder identities are unchanged in this migration.
Codex reads `.agents/skills`; Claude's relative `.claude/skills` alias reads the same local copies.
Runtime discovery needs neither Home nor a sibling checkout.

## Updating

Use the canonical `tools/skills.py` from an explicitly selected Agent Kit clone with Python 3.11+.
Select named skills at a full commit SHA, preview, install, then check. Follow
[distribution instructions](https://github.com/KirillSachkov/agent-kit/blob/b1608ac14d8f934a8686a0c583f1110466a18b18/docs/distribution.md).
Never edit locked copies or force replacement. Keep installer backups ignored and retain their
matching locks; local changes require explicit reconciliation before adoption.

Migration base: `492636dd8660b44a028f0358ad9d7b86302ab9b9`. Nine managed selections were updated normally. Sixteen tracked
whole-folder variants were compared semantically, their project rules retained in owning contracts,
and their exact tracked bytes/modes adopted with a private temporary catalog at that immutable
base before selecting this public revision. Private receipts are not distribution metadata.
Original raw backups and installer backups remain ignored. Installed metadata, credits and notices
come from the source distribution.
