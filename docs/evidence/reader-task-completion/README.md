# Reader Task submission marks — design comparison

Owner assignment: 2026-10-15. Prototype only; no production change or owner selection yet.
Base source: `fa6f153e421d8f48823cba4a3ad24e3e2266f27a`.
Branch: `prototype/reader-task-completion`.

## Question and variants

How should the course Reader sidebar show a saved Task submission while retaining a readable title,
chapter-local Task numbering and an independent current-step indication?

- A: a subtle title strikethrough and submission date.
- B: an outlined check on the left and visible «Сдано» label.
- C: a checked node on the existing position rail; an accessible «Сдано» label remains available.

Use the actual CourseReadingLayout, chapter selector and compact programme panel. Prototype-only
portals change Task labels inside this existing presentation; production modules stay unchanged.
Fixtures and controls make no API writes. The public page, source course content and stand remain unchanged.

## State semantics

There is no persisted Task acceptance or completion field. The existing chapter API computes
`lastSubmittedAt` from the maximum saved `submissions.submittedAt` for the account and Task.
It does not filter by Task version or criterion success, and hides the mark when access is unavailable.
See `apps/backend/src/modules/product-tasks/features/list-chapter-tasks/list-chapter-tasks.ts`.

A saved submission means «Сдано», not passed or accepted. Agent review `ready` may include problems,
and is not a submission. Author `reviewedAt` means viewed, not accepted. The prototype preserves this
boundary: opening a page or preparing an unsubmitted report cannot add the mark.

The state controls show a new open Task, an already submitted open Task, and a ready report that
has not been submitted. Current selection is separate from submission state in every variant.

## Preview and evidence

URL: http://127.0.0.1:6023/iframe.html?id=prototypes-reader-task-completion--compare&viewMode=story&variant=A

Use `variant=A|B|C` and `state=0|1|2`. Bottom arrows and Left/Right cycle variants.
State controls update the URL. On phones, open «Вся программа» to inspect the sidebar in its sheet.
Reload preserves the selected variant and scenario.

Start from this worktree after the normal workspace install and generated-package build:

```sh
pnpm --filter @inside/web exec storybook dev --host 127.0.0.1 --port 6023 --no-open
```

The coordinator owns the live preview: port6023, PID88651, worktree
`/Users/dev/Work/Products/inside/platform.worktrees/reader-task-completion`, log
`/tmp/platform-task-completion-6023.log`. Keep it available during owner review. Stop only that owned
listener when review ends; preserve other Storybook servers and the main application stand.

Inspected A/B/C at desktop1440 and phone390. Screenshots are adjacent to this file. Each variant
preserves `aria-current=step` when the submitted Task is open, has no horizontal overflow, and leaves
the unsubmitted Task unmarked. Named scenario controls and keyboard/reload behaviour were checked.
Focused oxlint and Web TypeScript passed. Full application checks are outside this throwaway proof.
