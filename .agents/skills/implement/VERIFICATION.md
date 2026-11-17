# Independent verification and owner evidence

Read the target project's acceptance/testing rules and the task before choosing verification.
Tests protect behavior against regressions. Independent review checks the implementation.
A fresh verifier checks the corrected result and returns observed outcomes with artifacts the
owner can assess without reading code. These are separate forms of evidence.

## Handoff and result

When the target requires independent verification, use a fresh agent that did not write the
change, after the review corrections and affected checks. Supply the task's scenarios, expected
results, immutable base and corrected head or snapshot, original review findings and dispositions,
post-review changes, and the project's environment and evidence instructions.

The verifier:

1. Derives scenarios from the task/specification and acceptance criteria. Keeps explicitly
   requested scenarios required and records missing expectations as unresolved.
2. Confirms the running or inspected result corresponds to the supplied revision. Uses the
   project's real user or public interface and checks relevant side effects.
3. Chooses proportionate evidence for each outcome: screenshots for visible state, recordings
   for motion, action/expected/observed tables for data or permissions, measurements for speed,
   or inspectable snippets and state diagrams for non-UI work. Opens artifacts to confirm their
   claims and data provenance; publishes only data permitted by the target project.
4. Reports the checked revision and covered change, each expected and observed result, artifact
   locations, unresolved notes and unavailable coverage. Separates environment/setup limitations
   from observed product failures using the target's acceptance contract. An unexercised scenario
   is never reported as passed; a limitation does not waive an explicitly required scenario.
5. Returns the project's verdict and limits. Records start/end and token usage when required;
   unavailable tokens stay unavailable, never estimated.

For bug fixes where the target requires independent red proof, the fresh verifier runs the
regression against the base implementation in an isolated owned context, then against the fix.
Record exact commands, revisions and outputs; distinguish the expected assertion failure from
setup failure. Preserve other writers' checkouts. Reversible visible fixes still need evidence
proportionate to their consequences, not an automatic whole-application tour.

The caller resolves technical defects within the assignment and reruns affected checks and
verification as needed, retaining original findings and correction evidence. Follow the target's
freshness rule after later edits; name the exact checked head and any uncovered changes.
This does not introduce another code-review round. If verification is inapplicable, record the
project-based reason rather than inventing a runtime, route map or visual parity requirement.

## Owner attention

Technical findings stay with agents until fixed or explicitly dispositioned under project rules.
Questions about intended outcomes, consequences or approval scope follow the target's human
participation contract. Existing permission persists within its recorded assignment and scope;
when relayed, retain who authorized what, when, and where the instruction came from.

If the target requires a final classifier, `ship` invokes it after review dispositions,
verification and final checks. Supply the task, original Spec notes, post-review changes,
current verdict/artifacts, unresolved findings, final checks and target consequence/authority
rules. The classifier reads and returns only the target-defined status, reason and owner action;
it edits nothing and requests no repairs. Finish technical work before this last classification,
not in a classifier repair loop. Apply the target's invalidation rule if the result later changes.
Classification grants only the authority the target explicitly associates with its status.
