# Triage labels

Use the canonical roles from `mattpocock/skills` without renaming them.

| Canonical role | GitHub label | Meaning |
|---|---|---|
| `needs-triage` | `needs-triage` | Maintainer evaluation is required |
| `needs-info` | `needs-info` | Reporter information is required |
| `ready-for-agent` | `ready-for-agent` | Fully specified for autonomous agent implementation |
| `ready-for-human` | `ready-for-human` | Human implementation or judgment is required |
| `wontfix` | `wontfix` | The work will not be actioned |

Resolve owner decisions and record the
[key scenarios](human-review.md#agree-in-the-specification) before `ready-for-agent`. Root [AGENTS.md](../../AGENTS.md#process) owns what
starts work.

Every triaged issue has exactly one role from this table; a specification or version has none once
it has sub-issues. `ready-for-human` is only for work a human does. The `wayfinder` skill adds its
own `wayfinder:*` labels; `production-lock` marks the [production lock](production-lock.md) and
carries no role. There are no category labels (`bug`, `enhancement`): `triage` sets only
the role from this table.

These project rules override the pipeline skills:

- `to-spec` publishes the specification without `ready-for-agent`.
- `to-tickets` applies `ready-for-agent` to a fully specified ticket. After publishing it removes
  `ready-for-agent` from the parent.
- `triage` keeps the rejected-request record in its `wontfix` closing comment; there is no
  `.out-of-scope/` directory.
