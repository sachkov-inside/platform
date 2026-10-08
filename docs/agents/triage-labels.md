# Triage labels

Use the canonical roles from `mattpocock/skills` without renaming them.

| Canonical role | GitHub label | Meaning |
|---|---|---|
| `needs-triage` | `needs-triage` | Maintainer evaluation is required |
| `needs-info` | `needs-info` | Reporter information is required |
| `ready-for-agent` | `ready-for-agent` | Fully specified for autonomous agent implementation |
| `ready-for-human` | `ready-for-human` | Human implementation or judgment is required |
| `wontfix` | `wontfix` | The work will not be actioned |

Every triaged issue has exactly one role from this table; a specification or version has none once
it has sub-issues (`WORKFLOW.md`, Routes). `ready-for-human` is only for work a human does. The
`wayfinder` skill adds its own `wayfinder:*` labels. There are no category labels (`bug`,
`enhancement`): `triage` sets only the role from this table.
