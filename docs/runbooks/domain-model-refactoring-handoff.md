# Implement the complete Platform domain refactoring

Use this handoff when the owner assigns implementation of
[the complete specification](https://github.com/sachkov-inside/platform/issues/1693).
It provides execution context; the owner's assignment and current WORKFLOW govern authority.

## Assigned result

Implement the whole specification through `implement-spec`: production code, migrations, interfaces,
Web and Telegram callers, generated contracts and meaningful tests. Finish all five active tickets,
assemble the integrated result, complete required review and checks, and reach the authorized
delivery boundary. A plan, updated documents, newly created tickets or one completed ticket is
not completion of this assignment.

The owner requested this implementation handoff on 2026-10-23 and replaced the 14-ticket breakdown
with five larger tickets. The earlier Wayfinder planning restriction on product-code changes
belongs to the completed preparation session; an explicit assignment to implement this specification
authorizes code changes. The accepted domain decisions remain in force.

## Read and reconcile

1. Read root AGENTS, WORKFLOW, the issue tracker, coordinated-execution contract, domain context
   pointers and applicable application instructions. Follow the local stand runbook before Compose.
2. Read the specification's full body and comments and its five active native sub-issues. Check
   assignees, branches, PRs and recovered results before claiming work. Superseded tickets are
   provenance, not an additional active execution graph.
3. Read the current glossary, Telegram glossary, access model, context map and checked-in
   domain-model-refactoring specification. The completed Wayfinder map links each product decision;
   do not reopen those questions or use historical tariff/subscription text as current requirements.
4. Apply `implement-spec` and its required `implement`, `tdd`, `classify-change` and `code-review`
   stages. The project coordinated-execution contract owns worker routing and resource ownership.

## Active graph

| Order | Ticket | Depends on |
| --- | --- | --- |
| 1 | [Platform structure: transactions, Products and Account Profile](https://github.com/sachkov-inside/platform/issues/1708) | None |
| 2 | [Purchases and Product Access without tariffs or subscriptions](https://github.com/sachkov-inside/platform/issues/1709) | 1 |
| 3 | [Product reading, tasks and learning history](https://github.com/sachkov-inside/platform/issues/1710) | 2 |
| 4 | [Telegram community, message sequences and notifications](https://github.com/sachkov-inside/platform/issues/1711) | 2 |
| 5 | [Migration completion and whole-result verification](https://github.com/sachkov-inside/platform/issues/1712) | 3, 4 |

All 85 acceptance criteria from the original 14 tickets remain inside these five tickets as ordered
internal checklists. Keep technical expand/migrate/contract steps and verifiable commit batches
inside their owning ticket. The owner requested fewer tracker tasks; routine implementation detail
does not justify recreating the former 14-ticket graph. Record real external blockers under WORKFLOW.

## Coordinate implementation

Create one integration branch from current origin/main in the assigned writing context. Use native
implementer and merger workers, each implementer owning an isolated worktree based on that branch.
Do not substitute independent owner sessions for native workers. Merge reviewed worker results
into the integration branch, update the frontier and continue until the whole graph is implemented.

Run tickets 1 then 2. Tickets 3 and 4 may run concurrently when worker capacity and stand ownership
permit; ticket 5 follows both. Bound concurrency so required independent review and classification
workers can run. Serialize shared Compose/runtime operations. Keep exploration and evidence in the
coordinator's ignored `.reports/` directory. Preserve unrelated resources and the owner's checkout.

Each ticket requires its own independent review before integration acceptance. The final integrated
result receives a separate review, classification and mandatory checks. Track commits, review
dispositions, test evidence, owners and the next action in the existing issue/PR. Open the draft
integration PR once it has reviewable commits, following WORKFLOW rather than waiting for all work.
Close implementation tickets through actual delivery evidence, not because their criteria were
copied into another document. On resumption, reconcile the actual graph and continue remaining work.

## Preserve the owner's decisions

Use the current access model as authority. In particular, preserve these decisions when interpreting
historical code or documents:

- One lifetime Product Access per Account and Product, including its future published Materials
  and community, regardless of purchase, verified course activation or manual issuance.
- No tariffs or subscription capability anywhere, including dormant renewal, Tribute, invitations
  and entitlement bridge. Preserve one-time payment recovery, linking, course activation and passive
  financial/legal history while removing those mechanisms.
- Support is promised for three calendar months in documents, from confirmed payment or actual
  free issuance. It creates no access cutoff, renewal or repeat-purchase flow.
- The owner performs refunds manually through T-Bank and withdraws access separately. Closing sales
  blocks every new payment, including private links, while preserving holders and resolving already
  sent bank operations. Bot activation cannot restore a manually revoked Product Access.
- Bot marketing is allowed after /start without separate consent. Preserve /stop, /resume without
  backlog, Contactability and the independent application sending-mode gate.
- Catalogue membership, repeated programme placements and chapter references remain distinct.
  Preserve stable IDs, current Material content, learning history, private Account Profile and the
  authorized active-name-only author view. Accepted learning-map decisions are unchanged.

## Verify working behavior

Test changed behavior first at the agreed public seams: backend capability/buyer interfaces against
real isolated PostgreSQL, portable Telegram/provider contracts, and Web behavior through the fake
backend. Fake genuinely external providers, not the transaction and persistence behavior under test.
Prove repeat/concurrent requests, unknown outcomes, rollback, Account isolation, exact bindings and
moderation. Run mixed-fixture upgrade and restore, checking immutable legal/financial facts and
personal learning records before and after. A route rename or passing typecheck alone is insufficient.

Complete the project's final product check or permitted exact-head CI evidence, current-head CI,
merge-queue checks, documentation checks and triggered security/frontend verification. Use the
trusted target policy for classification. A prepared result needs any owner acceptance that policy
actually requires; finish independent work and present the concrete result before asking for it.
Existing authorization persists. Ask only for a new material product choice or a real unresolved
authority condition, citing the applicable rule, rather than repeating accepted decisions.

## Delivery boundary

Preparation approval does not authorize production data changes, real bank operations, actual
messages or legal-edition publication. Keep accepted editions and snapshots immutable. The existing
legal preparation issue remains the condition for opening sales on changed commercial terms;
record that condition without using it to stop independent code implementation and fixture tests.
Deployment follows its own current authority and runbook. Do not add one to this assignment.

Finish the fully implemented integrated PR and proceed through merge when current owner gates
permit. If a mandatory prepared-result acceptance remains, report the ready result, evidence and
one concrete decision at that boundary. Do not stop earlier at a plan or ticket-creation handoff.
Perform session-cleanup for owned resources and report implemented behavior, checks, integration
and publication separately, with any material remaining condition.
