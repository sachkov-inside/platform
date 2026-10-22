# Agent-led task submission

Status: implementation in progress for [#1504](https://github.com/sachkov-inside/platform/issues/1504).
Owner direction: 2026-10-15. This specification describes target behaviour; it is not runtime evidence.
The owner assigned implementation and direct review on the existing local stand in the same branch.
The owner accepted the monochrome roadmap prototype on 2026-10-15.
The accepted proof and decision are preserved on `prototype/1504-submission-monochrome` at `70817c11`.
Promote the three numbered sections: MCP connection, review start, and results with feedback.
Use a white surface and an explicit labelled setup button. Keep the review request and results visible.
Owner refinement on 2026-10-16: use compact numbered steps, a light copyable request and message-style results.
The learner starts the review in a fresh agent session in the completed project's directory.
Keep Storybook states alongside the production component. Prototype acceptance does not replace production visual acceptance.

## Responsibilities

The learner works in their own agent: discussion, project inspection, checks, report review and submission confirmation.
The task page supplies a short instruction, connection help, current review progress and saved submissions.
The participant submits through their agent; the task page has no manual submission form.
Platform stores agent statements; neither their presence nor their outcome constitutes an author's assessment.

## Context ownership

Inside Content owns the authored task and its versioned requirements. Platform imports them through the existing task publication path.
The public task page presents the assignment and learner-facing explanations.
Each task definition may additionally contain `reviewGuidance`: bounded author-written context for the learner's agent.
It describes task-specific evidence, relevant scenarios, acceptable alternatives and points that require attention.
It travels with the immutable requirements version; changing it creates a new version through the existing definition digest.
Learner HTTP responses explicitly omit this field. `learning_task_read` includes it in the complete version-pinned context.
This is agent-facing presentation, not confidentiality from the owner of that agent: a learner can inspect their own MCP responses.

Platform owns the common review procedure in `product-tasks/domain/review-protocol.ts`.
The MCP task read and `review_task` prompt share that procedure.
Task guidance supplies assessment data, not permission to run commands or override the common procedure.
The agent reads every context part before checking. Missing context stops the check.
The agent checks the public requirements using the supplied evidence guidance and respects valid alternative implementations.
The agent's report must cover every criterion of the reviewed version.

This delivery adds the field and transport boundary. Writing individual tasks' guidance remains Content-owned work.
It does not invent expected implementations or silently rewrite existing course originals.

## Connection help

Keep a short setup disclosure inside the submission component. It explains one-time HTTP MCP setup and browser sign-in.
A copy action supplies an agent-readable request with the canonical setup URL.
Detailed client instructions remain available in an inner disclosure using the same generator as the text endpoint.
The learner confirms sign-in through the MCP client's browser flow using the same Account as the website.
Copying a request and signing into the website do not prove that the agent connected.

## Review progress

A current review is mutable, separate from immutable saved submissions and scoped to one Account and task.
The agent reports `reviewing`, `ready`, or `stopped`, a short learner-facing message and optionally a complete report.
`ready` means the report is ready to discuss, including reports with violations or unverified criteria.
The agent publishes progress only with the learner's consent to sharing it with Platform.
Only the learner's agent calls the MCP update operation; the website reads progress.
The page shows the last server update time. Silence does not imply completion or failure.

Updates carry a run key and the expected revision returned by the previous read or write.
An update advances the revision once. Repeating identical content after a lost answer returns the existing result.
A stale revision or a closed run cannot overwrite newer work. A new run starts explicitly from the current revision.
Changing the task version invalidates updates using the old requirements.
Successful submission closes only its linked run within the same transaction.
The immutable submission retains `reviewRunKey`, so a closed key cannot be reused after another run starts.
Older clients can still submit without linking progress.

The website refreshes personal progress automatically while visible. The learner starts every check in their own agent.
It preserves the last successful read when an update fails and states that freshness could not be verified.
Background tabs stop polling. Guest pages do not request personal progress.

## Saved submissions

Only `learning_task_submit`, after confirmation of the exact complete report, appends an agent submission.
Progress and unconfirmed reports never count as saved attempts.
The learner history displays newest submissions first, with date, note, agent summary and criterion status counts.
The results surface presents actual agent summaries as messages with server timestamps and a distinct agent identity.
Author comments and manual submissions retain their own identities. Platform does not fabricate intermediate messages or acceptance verdicts.
The current progress remains the latest server snapshot, not a transcript of every progress revision.
The full criterion report and status counts are disclosed on demand and use the criteria of that submission's version.
The page offers connection and copy actions; a new check starts through the learner's agent rather than a website button.
Required violations, confirmed requirements and insufficient evidence remain distinct; additional work does not redefine the required outcome.
Existing manual submissions retain their repository, report text and note in history. They carry no invented agent statuses.
Author comments and viewed marks are independent. The page presents either, both, or neither without implying acceptance.

## Required evidence

Verify Account isolation, access checks, version conflicts, identical retries, stale progress writes and linked submission closure against PostgreSQL.
Verify that public task/history HTTP responses omit `reviewGuidance` and that complete MCP context includes it.
Verify first use, returning learner, progress, report with gaps, submitted history, absence of the manual form, guest, closed submissions and read/write failures.
Check the production component in Storybook and the live task route at desktop and narrow mobile sizes.
Record owner feedback, independent review, focused checks, full required checks and local application separately in #1504.
