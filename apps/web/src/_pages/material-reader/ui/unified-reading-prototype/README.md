# Unified guide and task reading pilot

Question: can chapter-one guides and tasks share a quiet reading composition and compact navigation, while preserving their distinct product controls?

Issue: [#1414](https://github.com/sachkov-inside/platform/issues/1414), child of #939.
Fixed base: `da5bad690eda14a1361d66cdacd16e1c886a8a8a`.
This is a Storybook-only proof on `prototype/unified-guide-task-reading`.
Production promotion and the owner visual verdict remain pending.

## Variants

- A: the complete chapter programme sits to the left of the shared reading column.
- B: article contents sit to the right; the programme opens from the shared compact panel.
- C: a single reading column includes an inline contents disclosure.

Use `variant=A|B|C`, `step=<fixture-id>`, and `scenario=ready|history|unavailable|version|closed|expired` on the iframe URL.
The prototype bar cycles variants. Arrow keys cycle outside interactive controls.
Its settings expose the in-memory submission scenarios.
Guide controls support local bookmark/read toggles; task controls expose submission only.
Navigation follows all 34 steps in the unchanged programme fixture.
The pilot sequence is the setup guide, harness task, then pipeline guide.

## Run and inspect

From the repository root:

```bash
pnpm storybook --port 6207 --ci
```

Open [the playground](http://localhost:6207/?path=/story/prototypes-unified-guide-task-reading--playground).
Direct [guide](http://127.0.0.1:6207/iframe.html?id=prototypes-unified-guide-task-reading--playground&viewMode=story&variant=A&step=inside-content-aie-ch1-project-setup)
and [task](http://127.0.0.1:6207/iframe.html?id=prototypes-unified-guide-task-reading--playground&viewMode=story&variant=A&step=aie-ch1-harness) links accept the same variant parameters.

Ports 6006 and 6206 belong to other sessions. Keep them running.
The isolated preview uses port 6207. No Compose or product stand restart is needed.

## Content and diagrams

The original programme proof, fixture and copied public assets remain unchanged.
All material/task prose and guide prompts render from that fixture through the production `MaterialBodyView`.
Only local composition styles replace repeated task whitespace.
The public task API snapshot records requirements version 2, review procedure version 3 and accepting state.
It contains no account data or learner submissions.

Source evidence:

- Programme fixture: content commit `dbee73a4278301468351a8932592b2561ff84e7e`, read-only capture on 2026-10-13.
- Canonical guide: Inside Content `guides/02. Inside AI Engineering/01. Подготовь проект к разработке/05. Как настроить проект и harness.md`.
- Canonical task: Inside Content `practice/ai-engineering/aie-ch1-harness.yaml`.
- Public task snapshot: `GET /library/products/ai-engineering/tasks/aie-ch1-harness`, local API, read-only capture on 2026-10-13.

The proof runs entirely from repository files; canonical paths above record provenance, not runtime dependencies.
The new code-native diagrams replace the guide's original exported image in this proof.
Their descriptions are derived from the source text and diagram relationships, not the stale exported ALT.
An overview follows the introduction. Open Brief and Skills focus figures follow their respective explanations.
The lookup focus follows the verification heading.
Personal instructions remain outside the project and are checked locally.
Project files go to `origin/main`; local tracker configuration points to GitHub Issues and labels.
Source and upstream commit are recorded in the project. An agent-specific folder pointer is conditional; Windows can use a copy.
The learner invokes `setup-matt-pocock-skills` manually, as the unchanged prose states.

## Submission boundary

The form writes React state only. Reloading discards demo submissions.
The shell reads use existing Storybook fixture responses, with no real auth or learner request.
The agent phrase and MCP address use existing product/Storybook helpers.
The optional repository, note and report match the product form's meanings.
History distinguishes submitted from author-reviewed and retains the requirements version.
The history scenario contains synthetic demonstration notes and author feedback.
Failure scenarios preserve entered text. Version recovery restores the captured version in the demo; the product requires a fresh review.
No submission, publication, learner data mutation or backend feature is implemented.

## Evidence and review

The initial batch covers A/B/C on 1440 and 390 CSS px, including whole pages, task bodies and submission regions.
Initial geometry records a 688 px desktop column, 28/18 px title/prose and 22/15 px mobile title/prose.
See [the evidence record](../../../../../../../docs/evidence/issue-1414/README.md).

Initial checks: focused TypeScript and lint passed; the Storybook MCP focused accessibility/test run passed.
The initial inspection also captured 720, 320 and 200% root-text enlargement.
Its fixes use a warm semantic gray diagram canvas, conditional source captions, a compact 320 programme control and collapsible prototype settings.
One confirmation batch, full repository checks and coordinator standards/spec review remain in progress.
The coordinator reviews the committed diff from the fixed base. Owner visual acceptance is the remaining promotion gate.
