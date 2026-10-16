# Project classification setup

Inspect actual behavior, trust boundaries, architecture/product/security sources, deployment authority, existing review, and documentation-maintenance rules.
For an existing project, propose `docs/agents/change-risk.md` as the single project policy source.
Link authoritative sources rather than copying architecture. Record stable consequences and verification needs, not every function or CI planner rule.
For empty projects, record deferral in the existing setup record; enable through an assigned update when behavior or agreed design exists.

The policy should define:

- Sensitive behaviors and trust boundaries, their consequences, and source pointers.
- Semantic low/medium/high criteria with mandatory project exceptions; high risk requires prepared-result acceptance before final merge.
- Required verification and concrete security/specialist triggers, independent of the general risk label.
- Conditions and stages for owner participation, existing action permissions, and deployment boundaries.
- Maintenance responsibility and links to the project's existing documentation-maintenance contract.

Present factual findings separately from authority choices. The owner approves participation, permitted actions, and mandatory checks.
Existing assignment approval remains valid within its scope; avoid renewed approval for accepted rules.
After accepting the document, add this exact declaration once in `WORKFLOW.md` or root `AGENTS.md`:

```text
Classification: enabled; policy: docs/agents/change-risk.md
```

Use the actual repository-relative path if the project selects another location.
Route `implement` and `implement-spec` to the installed `classify-change` skill through this declaration.
Keep project facts outside synchronized skill directories. Keep workflow routing short and link detailed policy instead of duplicating it.
Preserve existing skill invocation metadata, ticketing, TDD, and project delivery gates.

## Maintenance

Implementers update changed facts and references in the same PR; unaffected facts require no ceremonial edit.
Independent review checks stale statements and newly introduced sensitive behavior missing from the document.
Owner approval is required for changes to participation, permitted actions, or mandatory checks.
Assess policy-changing PRs under the trusted main-branch policy; candidate rules cannot authorize their own acceptance.
Pending work reassesses completion conditions after relevant accepted policy changes.
Enabled projects with missing policy fail closed for automatic merge; unconfigured projects retain their previous process.
Mechanical documentation checks prove presence and references, not semantic completeness.
