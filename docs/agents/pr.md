# PR body

**Pilot version** (#2206 and #2215, 2026-11-16). The owner approves the final look after a pilot on
real tasks; until then this shape is the working draft.

The PR is a short briefing for the owner, who accepts from evidence and reads no code
([human participation](human-review.md)). The `pr` skill's rules apply with three Platform changes:
the status is a `#` heading, the sections are ordered and named as below, and the check table,
rollback and review reports move under «Подробности», which is written for agents. Write in
plain Russian under `Human-facing text` of root [AGENTS.md](../../AGENTS.md#human-facing-text) and
keep the domain terms from the glossaries.

````markdown
# <статус>

<причина в несколько слов>

## От тебя нужно

1. <один вопрос «да или нет» одним коротким предложением>

## Что изменилось

<одно-два коротких предложения: что теперь может пользователь>

## Проверено

- <что делает пользователь и что получилось>: <одно доказательство>

Не проверено: <одна строка>.
Проверить самому: <одна строка>.

<details>
<summary>Подробности</summary>

<for agents only: the exact change, checked head and review base, commands to reproduce, the
check table with links to runs, review reports and their disposition, the verdict, rollback, the
classifier's duration and tokens>

</details>

Closes #<issue>
````

## Sections

The owner reads everything outside «Подробности» and nothing inside it.

- **Status**: the status [ship](ship.md#owner-attention) set, word for word, as the top-level
  heading; its reason is the line under it. No section explains why the owner was called.
- **От тебя нужно**: one or two yes/no questions. A question is one short sentence with no
  lead-in and no retelling of the reason, such as «Мержить с бледной первой строкой в невысоком
  окне (снимок 2)?». Say what «да» changes only when the question does not show it. Present only
  when the status calls the owner.
- **Что изменилось**: one or two short sentences on what the user can do now. No mechanics, no
  file or function names.
- **Проверено**: one line and one piece of evidence per scenario, taken from the manifest in
  `.evidence/` and the [evidence sources](human-review.md#evidence). The line says in everyday
  words what the user does and what came of it. Window sizes, pixels, commits, role names and
  commands stay out of it; when a size matters, say «в невысоком окне» or «на телефоне». A task
  with nothing to show gives one line on why, the CI link and the review result.
- **Не проверено**, **Проверить самому**: one line each, in the same everyday words; the
  `local-stand` skill prepares the stand the owner opens. A risk the owner must know is a question
  in «От тебя нужно» or the line «Не проверено».
- **Подробности**: only what an agent needs to continue or recheck the work. Nothing the owner
  must know or decide goes there.

Leave out a section with nothing to say. The owner's text stays under 70 words. Count the reason
line, the questions, «Что изменилось», the scenario lines of «Проверено», «Не проверено» and
«Проверить самому». Headings, captions under evidence and the `Closes` line do not count.

An earlier supporting PR uses `Part of #<issue>`; the final delivery PR uses `Closes #<issue>`.

## Attachments

Attach images and video with `gh pr create --attach`, `gh pr edit --attach` or
`gh pr comment --attach` (`gh` 2.99 or newer). GitHub stores the file outside the repository, so
`main` does not grow, and the picture shows in the PR body.

- **Public and permanent.** Anyone can open an attachment without signing in, and an agent cannot
  delete it. Look at every file before attaching it.
- **Test data only.** Record evidence for a PR only where the data is test data, and confirm that
  the database is the test one before recording. Under [`verify-platform`](../../.agents/skills/verify-platform/SKILL.md) that is a light instance;
  keep no file from the shared stand, which holds the owner's data, and give its result in words.
- **In doubt, leave it out.** When the data on screen may be real, attach nothing: link the CI
  artifact or describe the result in words.
- **Production stays in text.** Describe a production check in words; attach none of its screens.
- **A second look.** The fresh verifier looks through the artifacts for data that is not test
  data before attaching them ([verification](human-review.md#verification)).
- **Local, then gone.** The files stay in `.evidence/`, outside Git. They go with the worktree
  when the coordinator or owner removes it after merge and session exit under
  [session-cleanup](../../.agents/skills/session-cleanup/SKILL.md); the PR attachment stays.
- **Size.** An image and a video are limited to 10 MB each, and one command takes up to 50 files.
- **Formats.** PNG, GIF, JPEG and SVG; MP4, MOV and WebM.
- **Video player.** Reference the video file in the body with image syntax, alone in its
  paragraph, and attach the same file; inside a sentence it becomes a plain link.
- **Captions.** Give an image alt text after `#` in the flag and a caption naming the scenario and
  the observed result.

Larger reports and traces go by link to the CI run's artifacts. That link needs a GitHub sign-in,
downloads an archive and expires with the artifact's retention, so the briefing never depends on
it alone. Evidence for the owner stays out of the tree
([snapshots](../runbooks/local-verification.md#snapshots-as-issue-evidence)).
