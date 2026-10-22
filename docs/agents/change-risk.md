# Platform change risk

Use this policy for changes prepared for durable integration, including ordinary implementation
assignments and coordinated specifications. The shared classification skill owns the assessment
procedure; this document owns Platform facts and owner-participation conditions.

## Trusted policy and authority

Assess changes using this document from the trusted comparison target, normally `origin/main`.
Record that policy revision and the assessed base/head. A proposed policy cannot authorize its own
merge. Reassess affected conclusions after relevant code, assignment, or trusted-policy changes.

The owner maintains one developer workflow. Independent agent checks do not substitute for required
owner acceptance. Existing standing or task-specific authorization remains necessary for every
protected action; a favorable classification creates no permission.

High-risk changes require the owner's acceptance of the prepared result before final merge, unless
[advance acceptance](#advance-acceptance) covers them. Low- and medium-risk changes may complete automatically when the agreed scope, required evidence,
and existing authorization cover delivery. Require earlier participation for an unresolved business
decision or a protected action that precedes final merge. Integration into an isolated specification
branch is distinct from final merge and from applying changes to production.

If the enabled policy is unavailable or a material risk remains unresolved, gather missing evidence
and continue independent preparation. Stop before automatic merge if the uncertainty persists.

## Advance acceptance

Owner decision 1 (22.10.2026): an explicit owner assignment to finish the work through merge, such
as «сделай всё до конца», counts as acceptance of its high-risk prepared result in advance. Standing
merge authorization alone is not such an assignment. The agent still completes classification,
required checks and independent review, records them in the PR, and merges under existing merge
authorization.

Advance acceptance covers only the assigned scope and excludes three effects. Each keeps the owner's
acceptance of the prepared result before merge:

- production: deployment, production data, configuration, credentials or recovery;
- money: prices, payments, refunds, renewals, or entitlements bought with money;
- legal: legal texts, accepted commercial promises, or personal-data handling.

A change in the "Agent and classification authority" row still needs the owner's approval of the
changed controls (see [Maintenance](#maintenance)), and a proposed policy cannot authorize its own merge.

## Low-risk fast path

Owner decision 2 (22.10.2026). The **fast-path set** is a diff that changes only styling and
user-visible copy in `apps/web/src`: CSS, class names, design-token references, presentational
markup, visible text, and the stories that show them. It touches no authentication, session or
permission code, no billing or payment code, and no data fetching, persistence, transport or
schema. Files under `api/`, `*.server.ts`, `*.browser.ts`, `shared/auth`, `features/account-*`,
`features/billing-*`, `features/terms-acceptance`, `entities/subscription*` and
`entities/legal-document` leave the set, as does copy that states a price, an access right, or a
legal or commercial promise.

For a diff inside the set, the implementing agent writes one inline assessment in the PR (base,
head, trusted policy revision, "low risk: fast-path set", checks) in place of the two classifier
workers. Reuse it for later commits while the cumulative diff stays inside the set. When any change
leaves the set, run the full classification. Scoped checks and the short independent review remain.

## Asking the owner

When classification requires an owner decision or acceptance, ask one yes/no question in plain
Russian, add one sentence on what «да» changes (what merges, ships or becomes allowed), and link
the PR. Name the effect in everyday words; the classification record with its labels stays in the PR.

## Sensitive behavior and required evidence

Classify the actual semantic change. A comment in a sensitive module does not inherit its risk.
Conversely, a small change outside a named module can alter a protected behavior.

| Behavior and authority | High-risk condition | Verification needed when behavior changes |
| --- | --- | --- |
| Account, session, permissions and content access: [identity contract](../specifications/identity-principals-session-v1.md), [access model](../product/access-model.md) | Changes who can authenticate, act for another Account, or receive protected content; changes trust or authorization rules | Positive and negative authorization scenarios, Account isolation, direct and delegated access where applicable; separate security review |
| Purchases, grants, subscription and community rights: [payment model](../adr/0033-product-tariff-payment-model.md), [community/revocation model](../adr/0034-product-community-and-product-revocation.md) | Changes monetary effects, entitlement rules, refund/revocation outcomes, or accepted purchase benefits | Relevant buyer/access contracts; repeated and concurrent event handling, transactional effects and recovery when affected; security review when trust or permission changes |
| Persistent data and jobs: [backend context](../../apps/backend/AGENTS.md), [local database](../runbooks/local-database.md) | Destructive or incompatible migrations, loss of durable state, or a change with no demonstrated safe recovery | Real persistence/integration tests for affected behavior; migration compatibility, rollback or explicit irreversibility; retry, concurrency and crash recovery when affected |
| External REST/MCP/provider boundaries: [Web transport](../../apps/web/AGENTS.md), [Telegram boundaries](../../apps/telegram/AGENTS.md) | Expands authority, exposes secrets/private data, breaks public compatibility, or changes provider trust | Relevant schema/transport contracts and input validation; negative permission scenarios; separate security review for new/changed trust boundaries |
| Publication and legal commitments: [editorial boundary](../product/platform-mvp-brief.md#контент), [legal index](../legal/README.md) | Changes accepted legal/commercial promises or enables publication/external effects outside existing authorization | Verify the owning product/legal/publication contract; present the required owner decision before the protected action |
| CI, releases and deployment: [CI](../runbooks/continuous-integration.md), [release evidence](release-evidence.md), [release runbook](../runbooks/release.md) | Weakens a gate, changes trusted sources or credentials, affects production recovery, or permits a new protected action | Owning executable delivery contracts, relevant negative fixtures, source/evidence binding and recovery proof; security review when trust or credentials change |
| Agent and classification authority: [workflow](../../WORKFLOW.md), [pipeline provenance](../../.agents/skills/PIPELINE.md) | Changes owner-participation conditions, permitted actions, mandatory checks, or the authority used to assess those rules | Independent review under the prior trusted policy; owner approval of the changed controls; relevant local instruction evaluations and metadata/reference checks |

This table routes verification; package scripts and the owning contracts define actual commands.
Required CI and merge-queue coverage remain mandatory. Classification does not replace the
deterministic CI coverage planner or grant permission for real payments, external messages,
publication, credential changes, release, or deployment.

## Other changes

- Low risk: factual prose, comments, or copy that preserves runtime behavior, legal meaning and
  agent/delivery authority. Run scoped checks and a short independent review.
- Medium risk: agreed product behavior with bounded effects and no high-risk condition above.
  Verify acceptance criteria and affected existing scenarios; include failure/empty/access states
  and applicable browser evidence for UI changes under [frontend delivery](frontend-delivery.md).
- Preserve frontend owner-acceptance gates and temporary semantic UI exceptions from that contract.
  A medium-risk label does not waive required visual acceptance.
- Assign security review when the change affects authorization, external input handling, secrets,
  a trust boundary, or when security relevance remains uncertain. Explain why it applies or does not.
- Risk may decrease if the actual change is narrower than planned. Tests alone do not waive a
  mandatory owner condition or make an irreversible action reversible.

## Maintenance

Update relevant facts, references and new sensitive behavior in the same PR as the implementation.
Independent review checks both stale statements and missing risks. Use the
[documentation authority contract](documentation-maintenance.md); link facts instead of copying
product or architecture documents.

Factual updates follow normal review. Changes to participation, authority or mandatory checks need
owner approval and assessment under the prior trusted rules. A new owner decision takes effect
only in its accepted scope. Do not make a ceremonial edit when a change leaves this policy valid.

## Versions and recovery

The [pipeline provenance](../../.agents/skills/PIPELINE.md) records the installed shared source.
Issues and PRs retain assessed revisions, review outcomes, evidence and the next action.
Record the pre-adoption project commit and the accepted adoption PR for each pipeline update.

Restore compatible shared skills and project contracts through a selective reviewed revert.
Run documentation and affected tooling checks after restoration. Preserve later product changes;
do not reset the repository or treat a harness rollback as a product/data rollback.
Reassess active assignments if restoration changes their applicable completion conditions.
