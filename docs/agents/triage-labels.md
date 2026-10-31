# Triage labels

Use the canonical roles from `mattpocock/skills` without renaming them.

| Canonical role | GitHub label | Meaning |
|---|---|---|
| `needs-triage` | `needs-triage` | Maintainer evaluation is required |
| `needs-info` | `needs-info` | Reporter information is required |
| `ready-for-agent` | `ready-for-agent` | Fully specified for autonomous agent implementation |
| `ready-for-human` | `ready-for-human` | Human implementation or judgment is required |
| `wontfix` | `wontfix` | The work will not be actioned |

A label is context, not an assignment; resolve owner decisions before `ready-for-agent`.

Every triaged issue has exactly one role from this table; a specification or version has none once
it has sub-issues. `ready-for-human` is only for work a human does. The `wayfinder` skill adds its
own `wayfinder:*` labels. There are no category labels (`bug`, `enhancement`): `triage` sets only
the role from this table.

These rules replace parts of the pipeline skills:

- `to-spec` publishes the specification without `ready-for-agent`.
- `to-tickets` removes `ready-for-agent` from the parent after it publishes child tickets.
- `triage` records a rejected request in its `wontfix` closing comment, not in `.out-of-scope/`.
