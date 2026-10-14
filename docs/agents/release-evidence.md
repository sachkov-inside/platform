# Verification evidence

Use this policy for completion, release preparation, and deployment handoff. Coverage and source
identity determine readiness; the machine that ran a check does not.

## Task completion

Accept successful provider checks bound to the final PR head or its merge-queue candidate. Record
both the reviewed head and the actual CI checkout SHA, including GitHub synthetic merges. Keep
that provider binding; a synthetic checkout does not require duplicate local runs on the branch
head. These completion checks do not prove a different application's release source.

## Release evidence

1. The owner's release command freezes one main commit. GitHub `workflow_dispatch` binds that
   command to its `head_sha` and `head_branch`; `scripts/captured-release-main.sh` verifies the
   server run, repository and owning release workflow at planning and finalization. The selected
   SHA must equal that provider-captured main SHA. Later main commits neither replace this source
   nor block publication. Ordinal history and immutable manifests are revalidated independently.
2. `scripts/collect-release-source-evidence.sh` examines at most 30 successful Application CI runs.
   Only successful, completed runs in this repository from main push or the main merge queue are
   eligible. Their `ci-source-evidence` artifact binds source, tree, event, run and attempt, selected
   coverage and successful coverage. Every selected job must have succeeded. Provider run identity
   and its Git commit tree are checked separately through GitHub's API. Attempt-specific provider
   jobs must independently show a successful Coverage plan, CI Gate and every artifact-selected job,
   each bound to the same run, attempt and head SHA. Missing or skipped jobs reject reuse even if
   the run summary and artifact claim success. Receipts retain the reused provider job IDs.
3. Reuse requires the release tree, provider CI tree and artifact tree to be identical. This
   conservatively treats every tracked input as significant, including workflow, scripts, lockfile,
   runtime Markdown and configuration. A synthetic merge-queue commit can prove another SHA only
   through this verified whole-tree correspondence. Ancestry, a green summary or an edited source
   label cannot prove correspondence. Older, expired, unavailable or incomplete evidence leaves
   uncovered checks; it never grants an exception.
4. Both release workflows retain `release-source-receipt.json` as the `release-source-receipt`
   artifact for 90 days. Finalization retains `release-source-complete` with the successful gap
   workflow result and executed IDs; reused and executed IDs must partition the required plan. It names selected source/tree, required coverage, reused provider runs and
   their source/attempt, covered checks and missing checks. The reusable Application CI receives
   exactly those missing job IDs on the frozen SHA. Its CI Gate validates the selected gap plan;
   a failed or cancelled gap prevents publication. Platform includes full-stack access scenarios,
   parallel/serial integration and both Compose modes; Telegram includes its complete suite.
   Source evidence does not replace the images' digest/revision/schema verification.

`pnpm check` still defines task completion. Local targeted commands and `pnpm check:full` plus
guarded Compose remain development/diagnosis fallbacks. Compose evidence includes shutdown and
session-owned resources. Independent Standards and Spec reviews remain bound to the reviewed
change. Manual full-stack investigation remains available; no scheduled run is required for release.

Release readiness requires every applicable item to succeed on the selected source or its proven
identical tree. Missing checks run; failed checks need diagnosis. Record skipped, deferred or
owner-excluded checks explicitly under their existing authorization, never as passed checks.

## Release boundary

Publication still verifies immutable images, runtime bundle, schema identity, and rollback binding.
Deployment still requires fresh backup and isolated restore evidence, production readiness and
access checks, an announced interruption, and post-deployment verification. Business acceptance,
real payments, and opening sales keep their owner gates.

Harness documentation alone does not require an application release. Keep the active application's
selected SHA unless the approved application diff changes. Deliver documentation through its PR;
apply the owner's explicit current-session override while that PR completes.

The active course preflight v3 binds `selectedSourceSha` to the manifest, publication and all coverage.
Its receipts name coverage instead of local aggregate commands. Each receipt
binds its source and evidence reference; CI receipts also identify the successful workflow and job.
The operator verifies those references against GitHub before submitting the receipt. V1 receipts
remain valid historical inputs and retain their original requirements.
