# Ship

Platform facts for the `ship` skill: the merge, the owner-attention status and what it permits.
[Human participation](human-review.md) owns the rules of evidence; [owner attention](owner-attention.md)
owns the conditions of the status.

## Merge

Merge through the
[merge queue](../runbooks/continuous-integration.md#enqueue-a-checked-pull-request). `CI Gate` and
merge-queue CI stay required.

## Owner attention

Every task ends with a PR in the [briefing form](pr.md) with its evidence. Run the checks of every
[consequence](human-review.md#consequence-triggers) the change has. Then a classifier sets the
status that opens the PR: «Внимание не требуется», «Требуется решение» or «Требуется внимание».

Run the classifier once per PR and last, when the review, the
[verification](human-review.md#verification) and CI on the last commit have their final results
and no technical review finding is left unsettled.
Start the `owner-attention` skill as a fresh subagent and hand it the inputs its `SKILL.md` lists;
the conditions file is [owner attention](owner-attention.md). The Spec reviewer checks the change
against the task and leaves the notes; the classifier alone sets the status. Run it again when the
task's code changes after its decision; a merge of `origin/main` without conflicts needs no new
run. No CI check stands on top of the status. During the pilot (#2215) record the classifier's
duration and tokens in the PR under «Подробности».

### What the status permits

«Внимание не требуется» is the owner's standing permission to merge that task; quote nothing from
a chat. The other two statuses wait for the owner's explicit «да» in the PR: mark the PR ready
for review, stop, and report the status and his next action. An assignment to finish the
work does not replace that «да». The status is a rule, not a GitHub lock: agents work under the
owner's GitHub account.

### What merged without the owner

Label the PR with its status: `attention:none`, `attention:decision` or `attention:required`. The
owner sees what merged without him in
[merged PRs labelled `attention:none`](https://github.com/sachkov-inside/platform/pulls?q=is%3Apr+is%3Amerged+label%3Aattention%3Anone+sort%3Aupdated-desc).

### Measurement

The conditions change by numbers. A monthly repeat of the measurement in
[the delivery baseline](../research/issue-2186-delivery-baseline-and-review-experiment.md) reports
fixes after a merge, PRs whose status called the owner yet merged without his «да», and the
classifier's result on harmful and harmless edits like those of that report's part B. The owner
assigns each repeat as its own task.

## CI failures

Before the one re-run of an unrelated failure, open or reuse an Issue that names the test or cause
and the first failed run. A recurring cause raises its diagnosis priority and gives no new re-run;
a failure that then passes is not proof of a flaky test. The
[CI runbook](../runbooks/continuous-integration.md) describes recovery and the history report.
