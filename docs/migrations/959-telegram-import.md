# Telegram history import (#959)

Part of [platform#957](https://github.com/sachkov-inside/platform/issues/957), originating in
[workspace#253](https://github.com/sachkov-inside/workspace/issues/253).
[PR #968](https://github.com/sachkov-inside/platform/pull/968) imports the complete source history.

## Captured identities

| Identity | Value |
|---|---|
| Platform `origin/main` baseline | `75c2a5ff418669ff958350a47b37b97d988f9dc9` |
| Re-fetched source `inside-telegram/main` | `10dfbee3c9dd39d2dacdc39f8c7926ecd4498820` |
| Original source tree | `df8b0f3019751f0ed9a5b847c237eb42df4b8cfd` |
| Initial full subtree import commit | `ec962b19cd7c8c4dff3cd8e3c91d23ec7a9cf4d0` |
| Initial `apps/telegram` tree | `df8b0f3019751f0ed9a5b847c237eb42df4b8cfd` |

The source was re-fetched before import and did not drift from the coordinator's captured SHA.
The import used `git subtree add --prefix=apps/telegram` without `--squash`, before adaptations.
Its parents are the Platform baseline and the exact original source SHA.
Independent comparison confirmed identical trees and original-SHA ancestry at that import commit.

## Adaptation boundaries

The root workspace and lockfile own installation. Root TypeScript presets, lint and checked script
projects cover Telegram without weakening shared strictness. The bot keeps its own process,
database, migrations, queues, runtime interfaces and application regression suites.
Explicit text and truthiness checks preserve empty strings, zero and nullable values.

All original bytes under these paths remain unchanged from the initial import:

- `apps/telegram/src/database/migrations/`;
- `apps/telegram/docs/contracts/`;
- `apps/telegram/src/modules/community/contracts/`;
- `apps/telegram/src/modules/notifications/contracts/`;
- `apps/telegram/src/modules/subscription-activation/contracts/`.

The root `GLOSSARY.md` owns shared terms; the Telegram glossary owns only bot-specific terms.
Copied `WORKFLOW.md`, agent skills, nested toolchain configuration and lockfile were removed.
Application routers now point to the root process and Platform tracker. Legacy issue links remain
historical until #961 transfers tasks.

All three Dockerfiles consume the root workspace context and its frozen lockfile.
Telegram uses filtered build and `pnpm deploy --prod`, retaining the original image/runtime contract.
The root CI Gate requires Telegram fullcheck with isolated PostgreSQL and non-guest RabbitMQ.
Its executable gate test rejects failed, cancelled, skipped and missing bot results.

Nested Telegram workflows remain explicitly historical fixtures until #960.
Their release tests describe the original source-repository delivery contract; they are not active
monorepo publication paths. #959 changes only the Docker build context, workspace and CI integration.
Gateway trust, production environments, secrets, publication and deployment are left to #960.

## History-preserving merge

PR #968 must wait for the coordinator's approved temporary `MERGE` queue policy and an empty queue.
CI Gate and independent review remain mandatory. Squash cannot preserve the original ancestry.
The coordinator verifies the actual merge method and original-SHA ancestry on remote main, then
restores the original repository/ruleset policy immediately. This document records prepared import
provenance; the stage report records the observed merge and policy restoration after confirmation.
