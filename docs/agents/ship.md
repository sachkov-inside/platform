# Ship

Platform facts for the `ship` skill: merge, the decision whether the owner is needed, and advance
acceptance. [Human participation](human-review.md) owns the rules this decision applies.

## Merge

Merge permission follows `Owner gates` in [AGENTS.md](../../AGENTS.md#owner-gates). Merge through the
[merge queue](../runbooks/continuous-integration.md#enqueue-a-checked-pull-request). `CI Gate` and
merge-queue CI stay required.

## Owner acceptance

Delivery decides one question: call the owner before the merge or not. Either way the task ends
with a PR in the [briefing form](pr.md) with its evidence.

- **«Не звать»**: the agent merges.
- **«Звать»**: the finished PR waits for the owner's «да», each decision asked as one question, and
  names the condition that called him.

After independent review, required green CI and the
[verification](human-review.md#verification) the change requires, apply the
[consequence triggers](human-review.md#consequence-triggers) to the delivered change and run the
checks of every trigger that applies. Add the triggers the Spec reviewer reported.

The outcome is «не звать» when all four hold:

- behaviour does not change for users;
- the task says there is nothing to show;
- no consequence trigger applies;
- the independent review agrees: no open finding and no missed trigger.

Otherwise the outcome is «звать» and the owner accepts from evidence. Name the concrete result or
decision for the owner in the PR and handoff, with the full delivered SHA. Recorded acceptance of that exact thing in the
assignment or earlier conversation satisfies it; apply advance acceptance below only within its
scope.

Merge permission is a separate condition: merge only with recorded merge permission and every
owner acceptance satisfied. Otherwise mark the reviewed, green PR ready for review and stop at that
concrete remaining gate. Report CI state, the conditions that failed and the owner's next action.
Releases, deployments, production writes, payments and credentials stay with the owner whatever
the four conditions say.

## Advance acceptance

Owner decision 1 (2026-10-22): an assignment to finish through merge, such as «сделай всё до конца»,
accepts the prepared result in advance, except production, money and legal effects; standing
merge permission alone is not such an assignment.

## CI failures

Before the one re-run of an unrelated failure, open or reuse an Issue that names the test or cause
and the first failed run. A recurring cause raises its diagnosis priority and gives no new re-run;
a failure that then passes is not proof of a flaky test. The
[CI runbook](../runbooks/continuous-integration.md) describes recovery and the history report.
