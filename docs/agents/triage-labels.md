# Triage labels

Use the canonical roles from `mattpocock/skills` without renaming them.

| Canonical role | GitHub label | Meaning |
|---|---|---|
| `needs-triage` | `needs-triage` | Maintainer evaluation is required |
| `needs-info` | `needs-info` | Reporter information is required |
| `ready-for-agent` | `ready-for-agent` | Fully specified for autonomous agent implementation |
| `ready-for-human` | `ready-for-human` | Human implementation or judgment is required |
| `wontfix` | `wontfix` | The work will not be actioned |

For execution after triage, follow the [owner assignment rules](../../WORKFLOW.md#completion-requirements).

A specification or version carries no role; its tickets carry the readiness role. Every other
triaged issue has exactly one role from this table. `ready-for-human` is only for work a human does. The
`wayfinder` skill adds its own `wayfinder:*` labels. There are no category labels (`bug`,
`enhancement`): `triage` sets only the role from this table.
