# Local development

Start with the [local stand runbook](local-stand.md): stand ownership, start and stop, the guarded
Compose smoke, diagnosis and the destructive reset. The pages below hold the remaining local
procedures; open the one that matches the task.

## Stand and stack

- [Compose stack contents](local-compose-stack.md): services, images, configuration, object storage,
  the Kinescope test provider and the optional Storybook profile.
- [Local stand runtime](local-stand-runtime.md): production web build, memory and disk bounds,
  sign-in callbacks, troubleshooting and the disposable production smoke from owned cache.
- [Local stand accounts and product view](local-stand-accounts.md): the owner's purchase order,
  local account gateway and recovery, and where the owner's product data lives.
- [Local PostgreSQL and migrations](local-database.md): inspection, seed behaviour, migration and
  Prisma schema checks.
- [Former MinIO objects](local-minio-transfer.md): one-off copy into RustFS.

## Checks

- [Repository verification](local-verification.md): `pnpm check` stages, `pnpm check:full`,
  navigation checks, issue evidence snapshots and integration tests.
- [Heavy local checks](local-heavy-checks.md): the two machine-wide slots and runner limits.
- [Host Node.js fallback and MCP authoring](local-host-fallback.md): host processes, MCP tools,
  host smokes and the owned-process supervisor.

## Acceptance stands

- [Local editor acceptance](local-acceptance-editor.md): isolated `pnpm editor:local` runtime.
- [Local sale acceptance](local-acceptance-sale.md): bank double, mail capture, payment recovery,
  seeded offers and owner billing operations.
- [AI Engineering course acceptance](local-acceptance-course.md): `pnpm local:course` preview.
- [Local authoring preview](local-acceptance-authoring.md): Engineering Content import to `editor`
  or `stand`.
- [Isolated quiz acceptance](local-acceptance-quiz.md): quiz run against the editor runtime.

## Owner operations

- [Owner release operations](local-owner-operations.md): owner Account bootstrap and manual Member
  Profile moderation.
