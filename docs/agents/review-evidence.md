# Independent review evidence

Use this contract when recording Standards/Spec completion for a main-target PR or diagnosing
`Independent review evidence`. [WORKFLOW.md](../../WORKFLOW.md) owns semantic review;
[change risk](change-risk.md) owns participation. A receipt verifies completion claims, not merge
permission or an exception to another gate. Ordinary tasks acquire no new mandatory human approval.

## Trust boundary

GitHub authenticates the publishing account. The verifier reads current PRs, issue title/body,
comments and the publisher's current repository permission. A publisher needs `write`, `maintain`
or `admin` permission. The current repository-permission endpoint is authoritative;
`author_association` is informational and can hide private organization membership from CI.
Markers from accounts without write permission are ignored before parsing. Permission reads are
reused per publisher within one verification snapshot, including refusals. Initial permission API
failures fail closed. One authorized account may publish reports from separate native workers operating
under the same owner.

Native worker IDs, transcript references, completeness and finding dispositions are accountable
claims by that publisher. GitHub does **not** authenticate native worker IDs, prove transcript
existence, semantic independence or review quality. Distinct strings cannot prove distinct reasoning.
Keep actual native reports available for inspection. Invented identities and omitted findings violate
the existing review procedure even when JSON validation cannot detect them.

CI executes the verifier from the trusted target revision with a read-only token. The candidate is
Git data: no candidate dependencies or scripts run in that job. Workflow invocation remains subject
to the existing CI trust model and prior-policy independent review of candidate workflow changes.
This is not a separately protected, tamper-proof status authority. Such an authority would require a
separate protected-workflow and branch-rule rollout.

## Publish a receipt

1. Complete native Standards and Spec review at the immutable task head. Use the actual comparison
   base `git merge-base <current-target-sha> <task-head-sha>`. Preserve the implementer's identity and
   each reviewer's distinct native ID, transcript/report reference and returned outcome. Record every
   finding and disposition. After fixes, obtain applicable review at the new immutable head.
2. Capture the assigned GitHub issue's JSON object. Pipe it into
   `node scripts/review-evidence.mjs task-digest`. The digest covers exact title/body, including
   acceptance criteria, but excludes labels, comments and other metadata. Include that issue's full
   URL in the current PR body.
3. Prepare the JSON below. `findingsComplete: true` asserts that every finding is recorded. Empty
   findings are valid only when none were returned. Transcript references identify inspectable native
   reports/sessions; use actual worker IDs and references, never invented placeholders.
4. Run `node scripts/review-evidence.mjs render < receipt.json > receipt-comment.md`. Publish the exact
   body as an authenticated PR conversation comment through the existing authorized GitHub surface.
   The renderer has no token or publishing capability. External storage avoids changing the reviewed
   head by committing its own receipt.
5. Keep exactly one current receipt. Historical receipts may remain. Edit a duplicate/current bundle
   rather than adding another matching bundle. Re-run the failed CI after publishing; comments do not
   trigger Application CI. This exact-run rerun supplies newly completed evidence; it is not a retry
   of a flaky failure. Drafts may verify the same receipt, while GitHub keeps draft merging blocked.

```json
{
  "schemaVersion": 1,
  "repository": "sachkov-inside/platform",
  "pullRequest": 123,
  "task": "https://github.com/sachkov-inside/platform/issues/1855",
  "taskSha256": "<64 lowercase hex characters from task-digest>",
  "baseSha": "<40 lowercase hex characters: comparison merge-base>",
  "headSha": "<40 lowercase hex characters: reviewed task head>",
  "implementer": { "agentId": "<actual native implementer ID>", "transcript": "<session reference>" },
  "reviews": [
    {
      "role": "Standards",
      "agentId": "<actual native Standards worker ID>",
      "transcript": "<Standards report reference>",
      "outcome": "passed",
      "findingsComplete": true,
      "findings": []
    },
    {
      "role": "Spec",
      "agentId": "<actual native Spec worker ID>",
      "transcript": "<Spec report reference>",
      "outcome": "passed",
      "findingsComplete": true,
      "findings": [
        {
          "id": "S1",
          "severity": "blocking",
          "disposition": "fixed",
          "reason": "<correction confirmed by the affected reviewer>",
          "evidence": "<affected re-review reference at headSha>"
        }
      ]
    }
  ]
}
```

The renderer adds `<!-- platform-review-evidence:v1 -->` followed by JSON. Unknown/missing fields fail.
Finding severities are `blocking`/`nonblocking`, dispositions `fixed`/`rejected`/`deferred`. Every finding
needs a unique report-local ID, reason and evidence. A blocking finding must be fixed or explicitly
rejected by the affected reviewer. Deferred blocking findings fail. Roles, agent IDs and transcript
references are distinct across implementer, Standards and Spec.

## Applicability

The receipt binds repository, PR, task URL and title/body digest, immutable comparison merge-base and
exact PR head. A new head or comparison base needs a fresh receipt, including a head changed only to
merge main. An unrelated target advance preserves review when head and comparison merge-base are
unchanged. Task title/body edits invalidate review independently of code. There is no discretionary
applicability override.

For synthetic PR/queue checkouts, all pages of commit-to-PR associations and comments are read. Every
source must be a current main-target PR in this repository with its own valid receipt. Every commit
outside the trusted target must belong to a reviewed PR history or be an exact deterministic,
conflict-free two-parent merge of reviewed inputs. `git merge-tree` must reproduce its tree. Unknown
commits, altered merge resolutions, unsupported topology, missing history and API failures fail
closed. Multi-PR queue groups need evidence for every source.

The verifier rechecks current PR freshness before returning. API reads form a time-of-check snapshot,
not an atomic GitHub transaction. Required immutable-head CI and merge queue remain necessary.
Comment edits after a completed run are not continuously watched. Preserve published reports; a new
code head always needs its own current-head run.

`CI Gate` requires the review job's success and records applicability in source evidence. Missing,
skipped, cancelled or failed review jobs cannot count as successful coverage. Recovery can request a
real rerun only after successful review verification. Release reuse requires the successful provider
review job from the same source and attempt; older evidence lacking that job executes missing
coverage instead. Reusable release runs explicitly report `release-not-applicable`: they verify a
captured already-integrated source without requiring an open PR. Existing frozen-source, tree,
attempt, security and coverage requirements remain mandatory.

## Adoption and rollback

A trusted target without `scripts/review-evidence.mjs` explicitly reports `bootstrap-prior-policy`.
Prior-policy independent Standards/Spec, classification, required checks and owner acceptance of the
prepared agent controls still govern first adoption. File absence on the trusted target alone
selects bootstrap; candidate flags, receipt fields and discretionary exceptions cannot select it.
A present broken verifier fails. Proposed controls cannot authorize their own first merge.

After the owner accepts the prepared controls and the adoption PR merges, later PRs/queue groups run
the trusted target's verifier. Deleting or changing a candidate copy cannot select bootstrap. Changes
to the verifier, invocation or mandatory status remain authority changes assessed under prior policy.
Restore prior controls through a reviewed revert with the same owner gate and preserve review history.
