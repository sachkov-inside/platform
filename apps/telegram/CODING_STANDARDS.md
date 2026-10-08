# Telegram testing standards

Apply the [repository standards](../../CODING_STANDARDS.md), including
[deterministic test contracts](../../CODING_STANDARDS.md#deterministic-test-contracts-1153).
Application ownership and required checks remain in [AGENTS.md](AGENTS.md).

- Wait for an inbox row, committed delivery, drained queue or reported worker outcome. A timer
  starts work or stops a stuck wait; it does not prove delivery or shutdown.
- Each test creates its own recipients, identities and mutable provider state. Shared immutable
  command templates are copied before changing their binding. Reset a local double in a per-test
  hook; never read evidence left by an earlier case.
- Compile, migrate and prepare large audience corpora in bounded setup hooks before the case or
  latency measurement starts. Cleanup closes every owned process, connection and container.
- Unit tests supply provider, network, git and process doubles. A broker, PostgreSQL, loopback or
  shell-process contract names its real boundary and receives a separate failure budget.
- The root deterministic guardrail owns the syntax rules and reason comments. Review owns the
  semantic checks it cannot establish. Legacy scenario isolation and process-suite separation are
  tracked in #1154; their retained exceptions name that issue locally.
