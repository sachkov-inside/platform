# PR body

**Pilot version** (#2206, 2026-11-16). The owner approves the final look after a pilot on real
tasks; until then this shape is the working draft.

The PR is a one-minute briefing for the owner, who accepts from evidence and reads no code
([human participation](human-review.md)). The `pr` skill's shape and rules apply. Platform names
the skill's four sections in Russian and adds two: «Как это работает теперь» and «Как проверить
самому». Write in the owner's language (Russian) and keep the domain terms from the glossaries.
The extended shape in full:

````markdown
## Что изменилось для пользователя

<the user's new behaviour in two or three sentences; "ничего" for an internal change>

## Как это работает теперь

<each key scenario: one line on what the user does and sees, then its screenshot or video>

## Как проверено

- CI: <link to the run on the delivered head, result>
- Проверка работы: <verdict, who gave it, the change it covers; or one line why none is needed>
- Наблюдение агента: <what an agent saw itself>
- Не проверено: <limits, skipped checks, what the evidence does not prove>

## Как проверить самому

<the stand or a light instance, the account, a few steps and the expected result>

## Что нужно от владельца

<"Ничего" with the reason, or one yes/no question per decision>

## Риск и откат

<what can break and for whom; how to undo it, or why it cannot be undone>

<details>
<summary>Команды, журналы и ревизии</summary>

<checked head, review base, the full check table, review reports and their disposition>

</details>

Closes #<issue>
````

## Sections

- **Что изменилось для пользователя**: behaviour and consequences, with no inventory of files.
- **Как это работает теперь**: the key scenarios agreed in the task, each with its artifact. A
  task with nothing to show says why in one line and drops «Как проверить самому»; its evidence is
  that line, the CI link and the review result. For an internal
  change, choose the smallest view with the `pr` skill's `PRESENTATION.md` guidance.
- **Как проверено**: only the [evidence sources](human-review.md#evidence), each under its own
  label. Name a check you did not run, a skipped criterion, or a re-run of an unrelated failure.
- **Как проверить самому**: the `local-stand` skill gives the address and the sign-in.
- **Что нужно от владельца**: the outcome of [ship](ship.md#owner-acceptance), «не звать» or
  «звать» with the condition that called the owner, then what he is asked to look at or decide. Ask each decision as one yes/no question in plain Russian and add one sentence on what
  «да» changes: what merges, ships or becomes allowed. Record here the merge permission and the
  acceptance the owner already gave, in his words.
- **Риск и откат**: consequences in everyday words; say when one revert undoes the change.

An earlier supporting PR uses `Part of #<issue>`; the final delivery PR uses `Closes #<issue>`.

## Attachments

Attach images and video with `gh pr create --attach`, `gh pr edit --attach` or
`gh pr comment --attach` (`gh` 2.99 or newer). GitHub stores the file outside the repository, so
`main` does not grow, and the picture shows in the PR body.

- **Public and permanent.** Anyone can open an attachment without signing in, and an agent cannot
  delete it. Look at every file before attaching it.
- **Test data only.** Record evidence only on a light instance or the stand with test data, and
  confirm that the database is the test one before recording.
- **In doubt, leave it out.** When the data on screen may be real, attach nothing: link the CI
  artifact or describe the result in words.
- **Production stays in text.** Describe a production check in words; attach none of its screens.
- **A second look.** The Spec reviewer looks through the artifacts for foreign data before the
  merge ([verification](human-review.md#verification)).
- **Local until merged.** Keep the files in the worktree's ignored `ci-artifacts/` folder, outside
  Git; after the merge the `agent-worktree finish` step of `session-cleanup` removes them with the
  worktree.
- **Size.** An image and a video are limited to 10 MB each, and one command takes up to 50 files.
  The verifier records one short video per scenario, never the whole run in one file.
- **Formats.** PNG, GIF, JPEG and SVG; MP4, MOV and WebM.
- **Video player.** Reference the video file in the body with image syntax, alone in its
  paragraph, and attach the same file; inside a sentence it becomes a plain link.
- **Captions.** Give an image alt text after `#` in the flag and a caption naming the scenario and
  the observed result.

Larger reports and traces go by link to the CI run's artifacts. That link needs a GitHub sign-in,
downloads an archive and expires with the artifact's retention, so the briefing never depends on
it alone. Evidence for the owner stays out of the tree
([snapshots](../runbooks/local-verification.md#snapshots-as-issue-evidence)).
