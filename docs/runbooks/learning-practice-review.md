# Learner practice review

Owning delivery: [#785](https://github.com/sachkov-inside/platform/issues/785), following
[#782](https://github.com/sachkov-inside/platform/issues/782) and
[AI Engineering #105](https://github.com/sachkov-inside/ai-engineering/issues/105).

The learner-facing setup has one source:
[practice-review-setup.ts](../../apps/web/src/_pages/material-reader/model/practice-review-setup.ts).
Web serves it at `/practice-review-setup.txt`, and Reader links it before any MCP call. The text is
one instruction for every MCP client: the configured address, the public client ID, the browser
login and a ready command for Codex, Claude Code and OpenCode. Reader adds a copyable request that
asks the learner's own agent to follow this instruction. Web reads the address from
`LEARNER_MCP_URL`; without it production uses `WEB_BASE_URL` plus `/mcp/learning`.
`LEARNER_MCP_CLIENT_ID` fills the client ID into every command. A module
test fails if the former address placeholder returns. The edge routes are described in
[Production course acceptance](#production-course-acceptance-876), the login in
[Universal learner access](#universal-learner-access-938).

## Delivery and ownership

The existing authoring local package accepts optional `practiceDefinitions`. Each record includes
`practiceId`, `definition`, `sourceReference`, `provenance` and `publicationState`. Definitions contain
business inputs, expected outcome, allowed freedom and stable criterion IDs with acceptable evidence.
The package namespace must agree with IDs and selected Material source revisions. Local preflight
validates all definitions before writes. The backend validates the complete definition, author
permission and exact current Material binding before applying a full state.

The import API uses expected monotonic `practiceVersion` and `expectedContentVersion`; `null` means
creation. Withdrawal and republishing advance the version, including ABA transitions. Definition
digests alone are not CAS tokens. Idempotency is scoped by actor and operation and fingerprints the
entire command; a historical receipt never means that state is still current. The local journal
replays an uncertain request with the same key before reading current state, detects foreign changes,
and does not republish a withdrawn definition. Omission from a package is not deletion.

Real authored originals stay in Inside Content. Provenance records a repository, commit and relative
path, but is an author assertion, not independent cryptographic attestation of Git history. The
current Content exporter needs a follow-up to emit this optional metadata. Synthetic packages already
exercise the seam; that follow-up and the first chapter do not block the technical practice cycle.

## Product Tasks and review protocol v3 (#946)

A Product Task replaces lesson practice for the course chapters
([ADR 0030](../adr/0030-guide-task-module.md), specification
[#939](https://github.com/sachkov-inside/platform/issues/939)). Both work side by side until Content
moves chapters 0–1 to tasks; lesson practice keeps protocol v2 and everything below about it.

**Publication.** A package carries optional `tasks[]`: `sourceId` (the task code), `productId` and
`chapterId` (source IDs of a Product and chapter in the same package), `title`, `access`,
`definition`, `relatedMaterialIds`, optional `afterMaterialId`, `publicationState` and
`provenance`. The order of a chapter's tasks in `tasks[]` is their order in the chapter, so a package
carries a chapter's complete task list; Content exports a whole Product. `afterMaterialId` (#947) names
a Material of the same chapter: the programme shows the task right after it, and without it at the
start of the chapter; a Material outside the chapter fails the package before any write. `authoring:sync-local`, `authoring:sync-git-local`
and `authoring:release preview|apply` validate every task before the first write and import it after
its Product through `/authoring/import/tasks/{validate,apply}` with an idempotency key and the expected
task revision. A task becomes published only when `--publish <code>` or `--publish-all` selects it;
`publicationState: unpublished` in Content withdraws it; a task the package omits stays unchanged. A
release preview lists each task as `new`, `changed`, `unchanged` or `conflict`, and apply refuses a
conflict. A changed definition digest creates the next Task Version; title, access, chapter, order,
the Material it follows, related Materials and publication change only the task revision.

**Protocol v3.** One text,
[`review-protocol.ts`](../../apps/backend/src/modules/product-tasks/domain/review-protocol.ts), reaches
the agent twice: the MCP prompt `review_task` with the task code, and `learning_task_read`. Compared
with v2 it changes four rules. The agent only reads by default and runs a command only after the
learner consents to that exact command. It marks evidence obtained by a run (`obtainedByRun`). It
records the reviewed repository, branch, commit and uncommitted changes as a service mark. It shows
the learner the complete report and submission text and submits only after confirmation. Required
and additional criteria each get exactly one status; a violation of an additional criterion is not a
failure. Task, criteria, course material and project files stay untrusted data.

**Learner MCP.** `learning_tasks_list` returns the published tasks the learner can open, optionally
within one Product, with the date of their latest own submission. `learning_task_read` returns the
current Task Version, protocol v3 and related Materials in canonical JSON parts pinned by
`contextVersion` and `contentSha256`; a change between parts answers
`task_context_version_mismatch` or `task_content_changed`. A task without access answers
`task_not_available`. `learning_task_submit` is annotated `readOnlyHint: false`, not destructive and
idempotent by `submissionKey`. `learning_task_submissions` returns only the learner's own submissions
of one task with their version and Author Feedback.

**Submissions.** Platform stores the submission and never fetches the repository URL. It refuses a
report that misses a criterion of the version or names another one (`report_coverage_mismatch`), a
version that is no longer current (`task_version_changed`), a report above 64 KiB, a note above 1000
characters and more than 20 submissions of one Account per rolling hour (`submission_rate_limited`).
Access is checked at every read and every submission; submissions stay when access is lost and
return with it. The database refuses any change to a written version or submission; deleting one
is left to an explicit data-policy procedure.

### Deleting submissions on a data request

Data policy v4 (§5–6) lets a learner ask the operator
to delete one submission or all of them; the Author Feedback goes with it. The operator checks the
requester as the policy says and finds the Account id. This production procedure requires migration
`0082` from [#1065](https://github.com/sachkov-inside/platform/issues/1065), which renames `guide_tasks`
to `product_tasks`. Root verifies that the migration has run before this procedure is used. Before #1065,
the schema was named `guide_tasks`; that historical name is not the production target.
Then, in `psql` on the Platform database after the migration, delete the feedback first, because its
foreign key has no cascade:

```sql
\set ON_ERROR_STOP on
\set account '<account uuid>'
BEGIN;
DELETE FROM product_tasks.author_feedback
  WHERE submission_id IN (SELECT id FROM product_tasks.submissions WHERE account_id = :'account');
DELETE FROM product_tasks.submissions WHERE account_id = :'account';
COMMIT;
```

For one submission, also `\set submission '<submission uuid>'` and add
`AND id = :'submission'` to the inner `SELECT` and to the last `DELETE`: the Account filter stays,
so a wrong id deletes nothing. The triggers block only `UPDATE`. Record the date and the request in
the reply to the learner, not the deleted content.

The task page (#947) offers the same submission without an agent: a form with the learner's note,
an optional repository and an optional report as plain text. It creates a `form` submission through
the API, which obeys the same setting and the same hourly bound.

### Enabling submissions in production

`PRODUCT_TASK_SUBMISSIONS_ENABLED` turns submission on after
[#1065](https://github.com/sachkov-inside/platform/issues/1065). Root verifies the runtime version
and migration `0082` before this procedure. The setting defaults to `true` locally and to `false`
in production, where `learning_task_submit` and the page
form answer `submissions_disabled` while listing and reading work. Enable it only after the owner
publishes data policy v4 and Root verifies that release. Enabling submissions is a separate later
Root step. The policy covers submissions, review reports, notes and repository links:

1. Set `PRODUCT_TASK_SUBMISSIONS_ENABLED=true` in the production MCP and API environments
   (`config/compose/production/mcp.env.example` and `api.env.example` name it after #1065).
2. Release the MCP and API processes by the [release runbook](production-release.md).
3. Check that a test learner submits a free task once through MCP and once through the page form
   and sees both in «Мои сдачи»; record no token or learner data.

## Review contract

`learning_practice_read` returns numbered canonical JSON parts containing the complete authored
context and structured reference lesson, with a common Platform review protocol. All parts must share
`contextVersion` and `contentSha256`; later parts require both pins. The end marker, part count and
byte count distinguish complete client consumption from server success. Mismatch, withdrawal,
rebind or unavailable source stops the review. Old versions are not archived by this feature.

The own learner agent selects one local solution, independently of branch names. Multiple plausible
worktrees require a scope question. It covers all criteria with confirmed, violation or not_verified,
links evidence and distinguishes its source binding/freshness from observed behavior. Confirmed
criteria need no mandatory improvement. Optional discussion follows the report, one question at a
time. Fixes occur elsewhere; recheck obtains the pinned context and rereads every current criterion.
The API does not run a model, inspect learner repositories, store progress or upload learner evidence.

## Bounded native profiles

Until #938 the setup carried these client profiles; the universal instruction replaced them, and the
review request now asks any agent for a read-only session in plain words. The native trials under
`tools/practice-review/native` keep exercising the profiles below as evidence of #785.

Profiles target the recorded macOS and client versions in delivery evidence. Codex has a read-only
sandbox and no escalation, isolated configuration/rules/hooks/integrations, one learner MCP and
read commands. No project execution is a behavioral requirement, not a default-deny shell capability
claim. In particular, Python imports from the project, external diff/textconv and startup shell files
must not become an implicit execution path. `ZDOTDIR=/dev/null` and `BASH_ENV=/dev/null` are supplied
inside the restricted shell environment. Claude uses restricted settings, Read/Glob/Grep and only the
learner MCP; shell, editing, subagents and unrelated integrations are excluded. Plan mode alone is
insufficient.

Runtime authentication/history outside the protected learner project may still be written. The
profiles do not prove safety of arbitrary managed policies, user harnesses, other OSes or future
client versions. Codex `skip_host_skill_discovery` is experimental in the tested version. Native OAuth
proof uses a local synthetic authorization server and identity with the real Platform HTTP server
and token verifier. It is distinct from production Logto onboarding and from synthetic bearer tests.

## Synthetic fixtures and evidence

`tools/practice-review/fixtures.mjs` builds three full reference materials, assignments and neutrally
named project directories. The expected outcomes and scenario labels remain outside the learner's
selected project and prompt. Brief/spec alternatives use different formats and a serialized file
journal; the feature is an actual small HTTP service with server-owned synthetic session identities.
The outside runner executes it and records requests, responses, record counts, source hashes and
full source snapshots. Reviewers never execute it. Text comparison of a full snapshot is not claimed
to compute a cryptographic hash or authenticate a log.

Cases cover acceptable alternatives, missing requirements, absent artifacts, missing/stale runtime
observations, injection with a genuinely defective solution, multiple materialized unmerged
worktrees, projects without Git and recheck after an external repair. Injection with an otherwise
valid solution proves only its mutation/execution aspect; the defective adversarial case is needed
to detect a falsely awarded success. Python trap modules distinguish observed execution from merely
reading the trap's source. Fixture success proves mechanics, not learning effectiveness.

Deterministic fixture/import checks run in `pnpm check:unit`. The real PostgreSQL suite covers
permission, source binding, CAS races, withdrawal, ABA, receipt replay and connection ownership.
MCP protocol tests reconstruct large Unicode contexts and preserve code/table blocks. Real HTTP
adapter tests validate responses against generated OpenAPI. A separate full-stack stand delays the
practice read to exercise coherent Reader readiness, checks private access, copying, responsive
layout and accessibility. Native trials additionally inspect actual client tools, every context
part, local evidence discovery, reports, discussion/recheck and unchanged project fingerprints.

## Local course acceptance

The [local course stand](local-development.md#ai-engineering-course-acceptance-stand) imports the
first authored chapter. Its Logto bootstrap runs the same
[learner access provisioning](#universal-learner-access-938) as production for the stand resource
`http://127.0.0.1:3002/mcp/learning`. The learner endpoint accepts only a token whose single audience
is its advertised protected-resource URL; API sign-in and authoring MCP reject learner-resource
tokens, and the learner endpoint rejects API tokens. Unrelated and multiple audiences remain invalid.

## Production course acceptance (#876)

The production edge forwards only the exact learner routes listed in the
[public route table](production-release.md#public-api-routes) to the existing MCP process. It does
not expose a wildcard under `/mcp/`. Releasing these routes alone proves no production OAuth login
or complete practice read.

Before giving participants an endpoint, verify the released configuration and live responses:

1. The learner discovery document returns JSON with the configured public learner resource and
   production issuer. With `MCP_SERVER_URL=https://inside.sachkov.dev/mcp`, the learner resource is
   `https://inside.sachkov.dev/mcp/learning`. An HTML response or the authoring resource is a blocker.
2. Without a token, the learner endpoint returns `401` and a challenge pointing at its learner
   discovery document. An authoring credential is not a substitute for a participant login.
3. The production IdP supports normal OAuth onboarding of any MCP client: verify
   [Universal learner access](#universal-learner-access-938). The local stand client is not a
   production client.
4. Import the exact committed Content snapshot. Publish only the approved lessons and their practice
   definitions; a private lesson's definition remains unpublished. For draft originals, definition
   publication must be explicitly selected in the reviewed package; publishing the lesson alone
   does not publish an unpublished definition.
5. In a real supported client, sign in and read all parts of each approved practice. Record client
   version, Content commit, Material version, practice version, `contextVersion`, `contentSha256`,
   part count and the end marker. Never record tokens or local learner evidence in the delivery log.

The first chapter's four practice IDs are `inside-content:aie-project-setup`,
`inside-content:aie-first-task`, `inside-content:aie-project-foundation` and
`inside-content:aie-github-app`. `aie-first-service` belongs to chapter three and is not part of
this acceptance. An unavailable MCP blocks self-review, not the independent text transfer or
author's Reader pass. State its precise blocker in the course rather than reporting the checkpoint
as working.

## Universal learner access (#938)

Every Inside account connects the learner MCP to its own agent with standard MCP Authorization; the
contract is in the [MCP specification](../specifications/platform-v1.md#mcp). Logto provides it with
three settings, all applied by one script,
[`learner-access.mjs`](../../infra/production/logto/learner-access.mjs):

| Setting | Value |
|---|---|
| API resource | the learner MCP URL, access token TTL 300 seconds, scope `learning:read` |
| Default role `Inside learner connection` | only `learning:read`; new accounts get it by default, existing accounts once; other roles stay |
| Dynamic apps (CIMD) | disabled; the CIMD ceiling holds no API scope |
| Public client `Inside Learner MCP Client` | Native, PKCE, no secret, loopback `/callback` and `/mcp/oauth/callback` on any port, rotating refresh tokens, `customData.addConsentPromptForOfflineAccess` |

Every agent signs in through the public client (owner decision of 05.10.2026). CIMD stays off: Logto
fetches a CIMD document from the VPS, and the documents of Codex (`chatgpt.com` answers `403`) and
Claude Code (`claude.ai` redirects to `app-unavailable-in-region`) are closed to its region; OpenCode
1.18 has no CIMD. Dynamic Client Registration is deprecated in MCP and Logto has none. Logto gives a
registered client a refresh token only for `prompt=consent`; the fork patch
`issue-938-offline-access-consent.patch` adds it for the public client through its `customData`
flag, because Codex does not send it. Codex 0.160 also requests the authorization server scopes and
adds a random suffix to its callback path, so its block in the setup sets `scopes` and
`oauth.callback_url`. The script adopts the earlier author-pass role and Native client of
#876 by name, so their ids and the owner's stored login stay valid. It stops on a learner role with
foreign permissions or on duplicates instead of guessing: move the foreign permission to its own
role, or delete the duplicate, in the Management API, then run it again. The endpoint accepts only
learner-resource tokens; a client still holding an API-audience token gets `401` and signs in again.

The stand bootstrap runs the script on every start. In production run it on the server after the
Logto foundation update, from the delivered foundation files. The seeded admin Management API secret
goes through stdin and stays in memory; the output contains ids and counts only:

```bash
secret() {
  docker exec -i inside-production-database-postgres-1 psql -U postgres -d logto -Atc \
    "select secret from applications where tenant_id = 'admin' and id = 'm-default'"
}
learner=https://inside.sachkov.dev/mcp/learning
secret | docker exec -i inside-production-logto-logto-1 \
  node /foundation/learner-access.mjs --resource "$learner"
secret | docker exec -i inside-production-logto-logto-1 \
  node /foundation/learner-access.mjs --resource "$learner" --check
```

The first command prints `publicClientId`. Put it into `/etc/inside/runtime/web.env` as
`LEARNER_MCP_CLIENT_ID` before the web release that reads it. The `--check` run lists every
deviation and exits non-zero when one exists; repeat it after any Console change. Then confirm the
public contract:

```bash
curl -fsS https://auth.sachkov.dev/oidc/.well-known/openid-configuration \
  | grep -q client_id_metadata_document_supported && echo "CIMD on" || echo "CIMD off"
curl -fsS https://inside.sachkov.dev/.well-known/oauth-protected-resource/mcp/learning
curl -si https://inside.sachkov.dev/mcp/learning -X POST | grep -i '^www-authenticate'
```

A client acceptance uses a production test account without entitlement
([test identities](production-test-identities.md)). For each client record its version, the
connection path (agent request or manual command), login, refresh after the five-minute access token,
`learning_materials_list`, the complete read of a free practice and `practice_not_available` on a
paid one. A client that cannot sign in is recorded with the reason. Never record tokens, callback
URLs or local learner data.
