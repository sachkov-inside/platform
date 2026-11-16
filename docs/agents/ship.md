# Ship

Platform facts for the `ship` skill: the merge, the owner-attention status and what it permits.
[Human participation](human-review.md) owns the rules of evidence; [owner attention](owner-attention.md)
owns the conditions of the status.

## Merge

Merge through the
[merge queue](../runbooks/continuous-integration.md#enqueue-a-checked-pull-request). `CI Gate` and
merge-queue CI stay required.

## Owner attention

Open a draft after the first push, in the [briefing form](pr.md). Until classification its first
line is `# Классификация ожидается`, with no attention label and no merge permission.
Every task ends with that PR and its evidence. Run the checks of every
[consequence](human-review.md#consequence-triggers) the change has. Then a classifier sets the
status that opens the PR: «Внимание не требуется», «Требуется решение» or «Требуется внимание».

Run the classifier once per PR and last, when the review, the
[verification](human-review.md#verification) and CI on the last commit have their final results
and no technical review finding is left unsettled.
Start the `owner-attention` skill as a fresh subagent and hand it the inputs its `SKILL.md` lists;
the conditions file is [owner attention](owner-attention.md). The Spec reviewer checks the change
against the task and leaves the notes; the classifier alone sets the status. It reads and returns
only a status, a reason and the owner text, changes no file and requests no fixes. The caller
replaces the draft heading and applies the status label. Finish all task edits before the one
classification; do not use the classifier as a repair/review loop. A later task edit invalidates
the status and merge permission: restore the pending heading and hand off the changed scope as
new work. A conflict-free merge of `origin/main` that preserves the task diff keeps the status.
No CI check stands on top of it. Record verification and classification start/end times, duration
and tokens in «Подробности»; say when the client does not expose tokens, without estimates.

### What the status permits

«Внимание не требуется» is the owner's standing permission to merge that task; quote nothing from
a chat. The other two statuses wait for the owner's explicit «да» in the PR: mark the PR ready
for review, stop, and report the status and his next action. An assignment to finish the
work does not replace that «да». His own PR comment counts, and so do his words relayed by the
coordinator and recorded in a PR comment naming that source (session, date and words). The comment
must approve this PR's result; a task assignment or approval of the rule change is insufficient.
The status is a rule, not a GitHub lock: agents work under the owner's GitHub account, so the
comment's GitHub author cannot distinguish his words from an agent's.

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
