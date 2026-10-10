# Telegram testing standards

Apply the [repository standards](../../CODING_STANDARDS.md), including
[deterministic test contracts](../../CODING_STANDARDS.md#deterministic-test-contracts-1153).
Application ownership and required checks remain in [AGENTS.md](AGENTS.md).

- Domain fixtures use a per-case fixed instant or virtual `CLOCK`, shared by producer and consumer.
  Expiration and "today" never depend on the machine's calendar. A finite corpus grant must stay
  valid or expired according to the case's fixed clock, even after its literal expiry passes.
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

## Table ownership

A module reads and writes its own tables. A caller passes its transaction to an operation owned by
another module when both changes must commit together. `database/` owns schema declarations,
migrations and retention, rather than product decisions.

`scripts/check-architecture.mjs` is the executable table-to-module inventory. It covers the current
`DatabaseSchema`, including its inherited storage interfaces. Communications owns `communication_*`;
Bot Contacts owns `bot_contacts` and `bot_contact_events`; Bot Sign-in owns `sign_in_*`; Identity
Linking owns links, link history, recovery and `telegram_identity_reservations`; Membership Evidence
owns `membership_*`; Community owns `community_*`; Subscription Activation owns activation and
invitation redemption; Notifications owns `notification_*`; Sales Funnel owns its event outbox;
Update Inbox owns `telegram_updates`; Outbound owns start-response delivery and transport slots and
fairness. Storage declarations in another module do not transfer runtime ownership.

The guardrail scans literal table-name occurrences outside comments in TypeScript source. It does
not trace dynamic names, aliases or indirect access, and may also see a type or ordinary string.
Its CLI fixtures accept each owner's access and reject foreign access; the test inventory is
exhaustive against `keyof DatabaseSchema`. This is a syntax check, not proof of every ownership
boundary.

There are no legacy foreign-table exceptions. CLI fixtures retain the former file/table pairs and
reject every direct access in them. Owner read queries may compose into the caller's SQL statement;
owner writes execute on the caller's transaction. `src/application/` wires contact and linking
effects without introducing module cycles. `src/app.module.ts` injects these effects and sign-in
reply eligibility. Product modules never import this composition layer.
