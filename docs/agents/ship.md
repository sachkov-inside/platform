# Ship

Platform facts for the `ship` skill: the merge, the owner-attention status and what it permits.
[Human participation](human-review.md) owns the rules of evidence; [owner attention](owner-attention.md)
owns the conditions of the status.

## Merge

Merge through the
[merge queue](../runbooks/continuous-integration.md#enqueue-a-checked-pull-request). `CI Gate` and
merge-queue CI stay required.

## Owner attention

Every task ends with a PR in the [briefing form](pr.md) with its evidence. Before the merge a
classifier sets one status, the first line of the PR, word for word:

- **«Внимание не требуется»**: everything follows the plan and the evidence is there.
- **«Требуется решение»**: the owner asked in the plan to see this before the merge.
- **«Требуется внимание»**: the change left the plan, touches a critical place, cannot be undone,
  is unfinished or has thin evidence.

Run the classifier once per PR and last: the review is closed, the
[verification](human-review.md#verification) verdict is in and CI is green on the last commit.
Start the `owner-attention` skill as a fresh subagent and hand it facts, none of your
explanations:

- the Spec reviewer's notes on what may concern the owner;
- the commits made after the review;
- the final facts: the verdict, open findings, CI;
- the plan with what the owner asked to see;
- [owner attention](owner-attention.md).

The Spec reviewer checks the change against the task and leaves the notes; the classifier alone
sets the status. Run it again when the task's code changes after its decision; a merge of
`origin/main` without conflicts needs no new run. No CI check stands on top of the status. During
the pilot record the classifier's duration and tokens in the PR under «Подробности».

### What the status permits

«Внимание не требуется» is the owner's standing permission to merge that task; quote nothing from
a chat. The other two statuses wait for the owner's explicit «да» in the PR: mark the green PR
ready for review, stop, and report the status and his next action. Releases, deployments,
production writes, payments and credentials stay owner gates under every status. Agents work under
the owner's GitHub account, so the status is a rule, not a GitHub lock.

### Advance acceptance

The owner may accept a result in advance. It counts only when the specification or task records it
in his words, not when it was said in a chat. It lifts the call of «Требуется решение»: the owner
declined beforehand to look at what the plan lists. It never lifts «Требуется внимание», and it
never covers production, money or legal effects.

### What merged without the owner

Label the PR with its status: `attention:none`, `attention:decision` or `attention:required`. The
owner sees what merged without him in
[merged PRs labelled `attention:none`](https://github.com/sachkov-inside/platform/pulls?q=is%3Apr+is%3Amerged+label%3Aattention%3Anone+sort%3Aupdated-desc).

### Measurement

The conditions change by numbers. A monthly repeat of the measurement in
[the delivery baseline](../research/issue-2186-delivery-baseline-and-review-experiment.md) reports
fixes after a merge, PRs whose status called the owner yet merged without his «да», and the
classifier's result on the set of planted edits. The owner assigns each repeat as its own task.

## CI failures

Before the one re-run of an unrelated failure, open or reuse an Issue that names the test or cause
and the first failed run. A recurring cause raises its diagnosis priority and gives no new re-run;
a failure that then passes is not proof of a flaky test. The
[CI runbook](../runbooks/continuous-integration.md) describes recovery and the history report.
