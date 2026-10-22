# Material-owned practical lessons with internal Tasks

Status: implementation assigned by the owner on 2026-10-15. Transport agreed with the Content coordinator.
The shared stand does not accept this feature until Platform reports receiver and runtime readiness.

## Outcome and ownership

Chapter one contains eleven visible Material steps. A practical Material contains its authored explanation,
example and practice, followed by the same submission workspace used by the existing Task page.
The internal Product Task remains the authority for criteria, requirements versions, access, MCP review,
submissions and author feedback. No second submission or agent protocol is introduced.

Content owns lesson bodies, diagrams, canonical Task definitions and the exporter. Platform owns the
receiver, typed application contracts, persistence, Reader composition and shared runtime lifecycle.
Chapter two retains its existing standalone Task behavior. Existing Task codes, IDs, URLs and history stay valid.

## Agreed package transport

```ts
interface MaterialTaskFeature {
  requiredFeatures: readonly string[]; // includes "material-task-v1"
  materials: readonly {
    sourceId: string;
    practiceTaskId?: string; // ordinary Task source ID, without a namespace prefix
  }[];
  tasks: readonly {
    sourceId: string;
    productId: string;
    chapterId: string;
    programmeVisibility?: "standalone" | "embedded" | "legacy";
  }[];
}
```

This extends the existing package rows; their other required fields remain unchanged.
An absent visibility retains old standalone behavior. Fields are opt-in: old package digests and imports
must retain their previous behavior. A package using the new fields must declare `material-task-v1`.
An unsupported feature must fail before uploads or target writes. Backend preflight must accept the
extended typed Task import before a release can apply it.

- `standalone`: existing independent Task programme item and placement behavior.
- `embedded`: exactly one main Material names the Task; the Task creates no independent programme row.
- `legacy`: no Material binding and no programme row; direct Task access, MCP and history remain available.

Visibility does not change publication, access, criteria, requirements versions or submission acceptance.
Binding and visibility are revisioned metadata. A criteria change still creates a requirements version.

Each embedded Task binds to exactly one Material in its own Product and primary chapter. Each Material
binds to at most one Task. Material and Task source IDs are distinct. Unknown, repeated, cross-Product,
cross-chapter and supplementary-only bindings fail validation. Embedded and legacy Tasks do not use
`afterMaterialId`; their source rows retain explicit Product/chapter ownership.

The receiver derives an embedded Task's Material reference from `materials[].practiceTaskId`, namespaces
source IDs once and resolves the target Material after its import and Product composition. The binding
belongs to Product Tasks; Materials must not import or read the Product Tasks module. Related Materials
and `afterMaterialId` retain their existing meanings and are not binding substitutes.

## Content authoring

A Material declares `practice_task: TASK_SOURCE_ID`. Its main programme membership determines the
embedded Task's Product/chapter. A chapter declares `legacy_tasks: [TASK_SOURCE_ID, ...]` for retained
unbound legacy Tasks. The exporter includes that Task closure in `tasks[]`; only the eleven visible
Materials enter chapter-one `chapters[].materialIds`. Existing chapter-two source and transport remain valid.

| Step | Main Material source ID | Internal Task code |
| --- | --- | --- |
| 1 | aie-ch1-course | none |
| 2 | aie-ch1-agent-choice | none; personal/global practice is ungraded |
| 3 | aie-ch1-agent-basics | none |
| 4 | aie-ch1-agent-workspace | aie-ch1-harness |
| 5 | aie-ch1-mvp-scope | aie-ch1-mvp-scope-review |
| 6 | aie-ch1-product-parts | aie-ch1-product-parts-review |
| 7 | aie-ch1-architecture | aie-ch1-technical-decisions |
| 8 | aie-ch1-pipeline | aie-ch1-foundation-plan |
| 9 | aie-ch1-environment | aie-ch1-running-skeleton |
| 10 | aie-ch1-check-ci | aie-ch1-quality-checks |
| 11 | aie-ch1-review | aie-ch1-foundation-readiness |

Retained legacy Tasks: `aie-ch1-mvp-design` and `aie-ch1-foundation`.
The existing harness Task loses only its personal-instructions criterion through Content's reviewed
requirements change. Its identity and previous submissions are not moved to another Task.

## Reader and programme

A bound practical lesson uses the production-owned submission workspace, including MCP setup, the
canonical agent phrase, live review and message-style history with feedback. Existing manual submissions remain readable; the workspace has no manual submission form. Sign-in, pagination
and refresh retain the Material URL and its validated course/anchor context.

Task access is checked independently from Material access. Personal history remains in an uncached,
Account-scoped boundary. Workspace errors do not replace or delay an otherwise readable Material body.
An unbound lesson renders no invented Task or verification state. The practice in step two has no binding.

Embedded and legacy Tasks create no additional programme positions, counters, previous/next entries or
chapter-selector entries. A chapter using embedded practice displays unified Material steps without
Task/Material format badges. Chapter two retains its current presentation. Reading activity and saved
Task submissions remain distinct persisted facts; opening a lesson or producing an unsent report never
creates a submission or changes `isRead` automatically.

MCP retains the current Task protocol and requirements versions. Its practice context includes the bound
lesson without truncation or a misleading partial-context claim. Existing chunk/version guards continue
to apply. A changed binding, requirements version or lesson version must not mix old and new context.

## Delivery and preservation

Platform provides reviewed receiver support and a verified runtime before Content imports this feature.
Content then creates a fresh ordinary release preview against that exact runtime; no stale preview or
journal edits are reused. Preserve all accounts, rights, submissions, review progress and reading states.
An additive schema change does not repurpose existing Task identities or rewrite historical versions.

Checks cover old-package compatibility; feature admission before writes; binding cardinality and chapter
membership; transactional revision/idempotency/concurrency; direct legacy routes; independent access;
MCP context/version guards; the eleven-step programme; workspace reuse and Account cache isolation.
Run required backend integration and full product checks, independent Standards/Spec reviews, and
responsive Storybook/live Reader checks on the final source before completing delivery.
