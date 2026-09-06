# Telegram communications acceptance — Platform #310

Status: local adapter acceptance; credentialed Telegram acceptance is **not complete**.
The [shared specification](https://github.com/sachkov-inside/workspace/blob/1553211220c44882dbacce7519dd50e35493090e/docs/specifications/telegram-communications-v1.md)
is the sole product contract. This runbook records evidence and operations, not a competing brief.

## Compatible applications

- Platform base: `43275923c6dde086b5fcf6a4cad1a39efcff0530`; acceptance implementation: the head
  of the #310 PR. Record its final SHA with each run.
- Telegram base: `449f0c696fd851448dc82b6e69d9924c215de52e`; provider fix and adapter environment:
  [Telegram #41](https://github.com/sachkov-inside/inside-telegram/issues/41). Record its final SHA too.
- Both own their source, migrations, database and dependencies. They communicate over authenticated
  HTTP; neither build reads a neighboring checkout. No new communications wire schema is needed.

`pnpm conformance:communications` in Platform pairs with `pnpm conformance:communications-provider`
in Telegram. The provider checks restored historical content through Platform `validate-content`;
HTTP and delegated MCP rollback therefore share the same exact-snapshot check and provider receipt.
Content validation is point-in-time. A later unpublish still takes effect at the Reader.

## Reproduce without external sends

Use each repository's pinned Node and pnpm. Install dependencies with `pnpm install --frozen-lockfile`.
Use two **fresh, disposable, separately owned** PostgreSQL databases whose names contain `proof` or
`conformance`, reached directly on loopback. Never reuse the local singleton application's database.
The commands run normal repository migrations and create synthetic records; they do not reset data.

1. In Telegram, set `DATABASE_URL` to its disposable database and run
   `pnpm conformance:communications-provider`.
2. In Platform, set `DATABASE_URL` to its other disposable database and run
   `pnpm conformance:communications`.
3. Record both `git rev-parse HEAD` results, command exits and stdout. The consumer closes its API,
   MCP and JWKS servers on completion. Stop the provider with SIGTERM/Control-C. Stop/remove only
   the disposable PostgreSQL containers created for this run; never delete shared volumes.

The fixture uses loopback ports 44111 (Platform), 44112 (Telegram), 44113 (provider controls), plus
an ephemeral MCP/JWKS port. Refuse occupied ports; do not stop another session. `CONFORMANCE_PLATFORM_URL`
(provider), `CONFORMANCE_TELEGRAM_URL` and `CONFORMANCE_TELEGRAM_CONTROL_URL` (consumer) are constrained
to loopback. The provider always supplies synthetic secrets, disables background workers and real
Telegram transports, and uses a controlled clock. It never loads a bot token from the environment.
Control routes are fixture-only, authenticated, and absent from the production application.

The consumer creates an explicitly synthetic published free Material and Series, uses real
communications HTTP and delegated MCP, receives real provider HTTP responses and reads public content
routes. Synthetic Telegram updates pass through the real webhook/inbox. Only the Telegram send port,
service-message send port and scheduler clock are controlled.

## Evidence matrix

Every row requires passing full verification on the recorded revisions. Existing integration suites
are additional real-PostgreSQL evidence; their fake transports do not become credentialed evidence.

| Shared story | Local evidence |
| --- | --- |
| 1. Sources, repeat/auth entry, common intro | Cross-provider start/reentry/intro; Telegram `funnels.integration.test.ts` concurrent sources, update replay, auth and malformed sign-in, archived fallback |
| 2. Changes and old/completed audience | Cross-provider C delay/additions, historical rollback HTTP/MCP; Telegram funnel suite edit/reorder/delete/rollback/pause and history |
| 3. Stop/resume and reachability | Cross-provider overdue addition suppressed; Telegram funnel suite virtual deadlines, unblock, service priority and concurrent stop |
| 4. Media and multipart | Six template IDs through MCP and six synthetic sends; Telegram communications suite snapshot/edit/deletion/permission; funnel suite terminal partial-cancel timestamp after unknown resolution |
| 5. Broadcast snapshot | Cross-provider scheduled launch, receipt replay, late join and stop/resume before 429 retry; Telegram broadcast suite union audiences, concurrent launch and in-flight cancel |
| 6. Failure and recovery | Cross-provider unknown/no resend/explicit skip and feature disable; Telegram funnel/broadcast suites independent workers, crash/claim/DB ACK, 429/permanent failure and explicit retry |
| 7. Owner/agent authority | Cross-provider publish/launch/rollback via HTTP/MCP, ordinary permission denial; Platform communications management/authorization/targets suites; browser smoke and Storybook cover UI adapters |
| 8. Content and analytics | Cross-provider real free Material/Series, paid Reader remains protected, repeated/forwarded token hits separate from unique tokens; Platform tracking integration suite durable retries, invalid targets and degraded persistence |

The browser command `pnpm smoke:communications` exercises Browser → BFF → real Nest/PostgreSQL on
desktop/mobile and writes `ci-artifacts/communications`. Its Telegram contract stub does **not** prove
provider scheduling. `pnpm check` covers Storybook, keyboard/UI tests, generated API and builds.
`pnpm test:integration` covers Platform PostgreSQL. Telegram uses `pnpm check:full` against its isolated
check database. Run the existing Membership/sign-in suites as part of both full gates.

## Operator failure, rollback and disable

Read delivery state and exact revision before acting. For `unknown`, inspect the original attempt:
never infer non-delivery from a missing ACK. `delivery.resolve` with `skip` advances explicitly while
preserving evidence. Use `retry` only with `duplicateRiskAccepted: true`, the same chosen operation ID
and expected revision; it may duplicate a real message. A confirmed 429 uses the provider's bounded
retry delay. A stopped broadcast recipient stays cancelled/suppressed after resume; create a new
broadcast if a later send is intended. Never erase receipts, attempts or suppression to force progress.

A rejected rollback leaves the current publication intact. Restore the target's valid free/public
state or select another historical revision, then retry the operation. Check revision conflicts before
retrying. Do not replace rollback with a draft save, which would lose its history semantics.

Before rollback deployment, retain both application's previous image/config revisions and all database
history. Deploying an older binary is not permission to rewind migrations or delete delivery rows.
Set `TELEGRAM_MARKETING_ENABLED=false` to prevent new marketing claims; leave service auth/link delivery
configured. In-flight requests must settle and unknown results still need explicit resolution. Confirm
zero new marketing attempts and functioning service responses before declaring the disable complete.

## Credentialed proof and launch prerequisites

The remaining #310 blocker is an explicitly approved controlled recipient and live test scope.
Before asking to send, prepare a dedicated test bot/database or an audited isolated audience, real
file references for all six formats, test Material/Series reachable at the configured public origin,
compatible deployed SHAs, configured authorization/content-validation/tracking callbacks, and rollback
and feature-disable access. Do not use `all` on a bot with a production audience for this proof.

The owner must approve the exact bot, test recipient(s), message/media samples and bounded sequence:
standard/theme entry and intro; six media samples including video_note+text; addition after completion;
stop/resume; one controlled broadcast; opening and forwarding a tracking link. Capture the actual
Telegram rendering and corresponding persisted delivery states without putting private IDs/tokens in Git.
Do not automatically resend an uncertain live sample. Authentication/linking must still work after stop
and after feature disable. Review mobile/desktop owner UI against the same provider pair.

Not tested by local acceptance: real Telegram delivery/rendering/file_id validity; real recipient
consent and privacy/retention; credentialed sign-in/link flow; production callbacks, ingress, TLS and
secrets; production enablement; payments; audience launch. None is implied by passing fake transport
checks. Keep #310 open until the required credentialed evidence exists. Merge, deploy and audience
activation remain separate owner actions.
