# Verification evidence

Use this policy for completion, release preparation, and deployment handoff. Coverage and source
identity determine readiness; the machine that ran a check does not.

## Collect once

1. Select and freeze the exact final source SHA before dispatching the release workflow. Keep that
   selection through delivery when `main` advances. Record each required check's command or CI job, actual source,
   outcome, and log or artifact reference. Read the actual checkout SHA for reusable workflows.
2. Reuse successful exact-source CI evidence for all covered checks. `pnpm check` defines completion;
   its static, unit, UI, and web end-to-end phases may be proved by their corresponding CI jobs.
3. Fill only named coverage gaps. Use targeted local commands for development or diagnosis.
   `pnpm check:full` and guarded Compose remain available as local fallbacks when equivalent CI
   evidence is missing. A local Compose run includes successful shutdown and owns its resources.
4. Before release, prove backend integration (parallel and serial), enrollment, buyer journey,
   full-stack access scenarios, and development/production Compose with cleanup. Reuse an existing
   successful exact-source nightly run for full-stack coverage. Dispatch it only when coverage is
   missing. Keep independent Standards and Spec reviews bound to the reviewed final change.

Completion requires every applicable coverage item to have successful evidence on the selected
source. A failed check requires diagnosis; an absent or stale check remains pending. A synthetic PR
merge SHA proves only that SHA. Final-source CI must cover a different release SHA; changing an
artifact's source label is not evidence. Record skipped or owner-excluded checks truthfully under
an existing explicit authorization; this policy grants no new exceptions.

## Release boundary

Publication still verifies immutable images, runtime bundle, schema identity, and rollback binding.
Deployment still requires fresh backup and isolated restore evidence, production readiness and
access checks, an announced interruption, and post-deployment verification. Business acceptance,
real payments, and opening sales keep their owner gates.

Harness documentation alone does not require an application release. Keep the active application's
selected SHA unless the approved application diff changes. Deliver documentation through its PR;
apply the owner's explicit current-session override while that PR completes.

The course preflight v2 binds `selectedSourceSha` to the manifest, publication and all coverage.
Its receipts name coverage instead of local aggregate commands. Each receipt
binds its source and evidence reference; CI receipts also identify the successful workflow and job.
The operator verifies those references against GitHub before submitting the receipt. V1 receipts
remain valid historical inputs and retain their original requirements.
