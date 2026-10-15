# Owner corrections

Follow this contract when the owner identifies an error in code, a technical decision, review,
or agent execution. An explicit correction authorizes fixing that work and preserving its stated
requirement within the assigned repository and scope. Ordinary questions and tentative preferences
remain discussion. Ask about materially ambiguous scope while continuing independent work.

This is a Platform extension. Upstream `retro` remains owner-invoked and proposes improvements;
this contract handles explicit corrections without invoking that manual skill.

## Close the correction

1. State the corrected behaviour and fix the current work. Identify whether the requirement applies
   to this case, one module, one application, or the repository. Preserve the owner's actual scope.
2. Find the existing authority and enforcement. If they already express the requirement, fix why
   implementation, checks, or review missed it rather than adding a duplicate rule.
3. Choose the smallest durable change using the [authority table](documentation-maintenance.md#choose-the-authority).
   Generalize only as far as
   the owner's correction and its demonstrated cause support. Read the relevant section rather
   than loading every standard into the implementer's context.
4. For a mechanically detectable failure, add or repair the existing check. Demonstrate that it
   rejects the violation and accepts a valid case. Keep semantic requirements with the reviewer.
5. Verify the changed authority, run `pnpm docs:check` when documentation changes, and complete
   the assigned deliverable's checks and independent review under `WORKFLOW.md`.
6. In the handoff, name the correction, its scope, the changed authority, and verification. A local
   edit, a reviewed commit, and integration into `main` are distinct states. Future sessions on
   other branches receive the requirement only after they incorporate the change.

A one-case correction can close through code and its focused test alone. Permanent prose requires
a reusable judgement criterion. An unresolved owner decision remains pending; time is not consent.
If recording is blocked, name the missing authority or decision and the remaining work explicitly.

## Scope and history

Issue and PR history retain the incident, evidence and resolution. They do not replace an active
rule or check. Keep synchronized pipeline skills unchanged; project extensions live in project
contracts. Another repository or a shared pipeline change needs its owning project's assignment.

## Keep the rules useful

- Update an existing rule before adding one. State the desired behaviour, applicable scope, and
  meaningful exceptions together. Link examples and rationale rather than copying incident history.
- When replacing prose with automation, retain judgement criteria that the check cannot prove.
  Check code and negative fixtures own syntax coverage; prose names the remaining review duty.
- When behaviour changes, update or retire its rule and check together. A repeated correction is
  evidence to inspect enforcement, reviewer inputs and routing, not a reason to repeat the rule.
- Standards are review inputs. Implementers use the assignment, scoped execution documentation,
  existing code and checks. They may consult a specific rule to resolve a concrete question.

Completion requires an outcome for every explicit correction: enforced in the owning authority,
already enforced with the missed path repaired, case-specific and fixed, or explicitly pending.
