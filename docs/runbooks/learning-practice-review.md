# Learner practice review

Owning delivery: [#785](https://github.com/sachkov-inside/platform/issues/785), following
[#782](https://github.com/sachkov-inside/platform/issues/782) and
[AI Engineering #105](https://github.com/sachkov-inside/ai-engineering/issues/105).

The learner-facing setup has one source:
[practice-review-setup.txt](../../apps/web/public/practice-review-setup.txt). Reader links the static
`/practice-review-setup.txt` before any MCP call. It explains the separate OAuth login, the tested
client profile, copying the lesson request, discussion and recheck. The deployment endpoint remains
an explicit placeholder until an approved release provides it. Practice review (#785) does not
deploy a route, register a production OAuth client, publish a course or certify a live IdP
onboarding flow. The edge routes come later, in
[Production course acceptance](#production-course-acceptance-876).

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
first authored chapter and provides a stand-only public Native OAuth client. The learner endpoint
accepts a single audience equal to its advertised protected-resource URL, in addition to the
existing API audience. This exception is scoped to learner MCP authentication: API sign-in and
authoring MCP still reject learner-resource tokens. Unrelated and multiple audiences remain invalid.

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
3. The production IdP supports the selected client's normal OAuth onboarding. Verify its public
   discovery, allowed client registration or pre-registered Native client, callback, learner
   resource, short token lifetime and refresh. The local stand client is not a production client.
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
as working. Update the participant setup's endpoint and tested profile only after this client pass.
