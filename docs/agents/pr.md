# PR body

**Pilot version** (#2206 and #2215, 2026-11-16). The owner approves the final look after a pilot on
real tasks; until then this shape is the working draft.

The PR is a short briefing for the owner, who accepts from evidence and reads no code
([human participation](human-review.md)). The `pr` skill's rules apply; Platform orders and names
its sections as below and moves risk, rollback and the check table under «Подробности». Write in
plain Russian under `Human-facing text` of root [AGENTS.md](../../AGENTS.md#human-facing-text) and
keep the domain terms from the glossaries.

````markdown
**<статус>.** <причина в несколько слов>

## От тебя нужно

1. <вопрос «да или нет»>. «Да» <что изменит>.

## Что изменилось

<два предложения: что теперь может пользователь и как было раньше>

## Проверено

- <сценарий одной строкой>: <одно доказательство>

Не проверено: <одна строка>.
Проверить самому: <одна строка>.

<details>
<summary>Подробности</summary>

<risk and rollback, checked head, review base, the check table, review reports and their
disposition, the classifier's duration and tokens>

</details>

Closes #<issue>
````

## Sections

- **Status line**: the status [ship](ship.md#owner-attention) set, word for word, then its reason
  in a few words. No section explains why the owner was called.
- **От тебя нужно**: one or two yes/no questions, each with what «да» changes: what merges, ships
  or becomes allowed. Present only when the status calls the owner.
- **Что изменилось**: what the user can do now and how it was before, with no file or function
  names.
- **Проверено**: one line and one piece of evidence per scenario, assembled from the verifier's
  inventory in `.evidence/` and the [evidence sources](human-review.md#evidence). A task with
  nothing to show gives one line on why, the CI link and the review result.
- **Не проверено**, **Проверить самому**: one line each; the `local-stand` skill gives the address
  and the sign-in.
- **Подробности**: everything else, in one disclosure.

Leave out a section with nothing to say. The text outside «Подробности» stays under 100 words;
captions under evidence do not count.

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
- **Local until merged.** The files stay in the worktree's ignored `.evidence/` folder; after the
  merge the `agent-worktree finish` step of `session-cleanup` removes them with the worktree.
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
