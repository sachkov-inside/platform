# Owner corrections

Follow this when the owner names an error in code, a technical decision, a review or agent
execution. An explicit correction authorizes fixing that work within the assigned repository and
scope. Questions and tentative preferences remain discussion. Upstream `retro` stays
owner-invoked; this contract does not invoke it.

## Close the correction

1. Fix the current work. Decide whether the requirement covers this case, one module, one
   application or the repository; keep the owner's actual scope.
2. Find the existing rule or check. If it already states the requirement, repair why
   implementation, checks or review missed it instead of adding a duplicate.
3. Choose the smallest durable change from the
   [authority table](documentation-maintenance.md#choose-the-authority). A mechanically detectable
   failure gets a check that rejects the violation and accepts a valid case. A one-case correction
   can close through code and its focused test alone. Permanent prose needs a reusable criterion.
4. Run `pnpm docs:check` when documentation changes, then the task's own checks and review.
5. In the handoff, name the correction, its scope, the changed rule or check, and the verification.
   Other branches receive the requirement only after they merge the change.

Every explicit correction ends in one outcome: enforced in its owner, already enforced with the
missed path repaired, fixed for one case, or pending with the missing decision named.

## Keep the rules useful

Update an existing rule before adding one. Link examples instead of copying incident history.
When automation replaces prose, keep only the judgement the check cannot prove. Retire a rule and
its check together. A repeated correction means inspecting enforcement and routing, not repeating
the rule. Keep synchronized pipeline skills unchanged; project rules live in project documents.
