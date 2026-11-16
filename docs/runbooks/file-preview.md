# Light file preview

`pnpm preview:files` shows a lesson or a Task page of a local Content package the way sachkov.dev
renders it, and reloads the page when the package changes (#2221). It needs no backend, database,
Docker, stand or sign-in, and starts in a few seconds. The shared stand stays the place for checks
before a release: access, navigation, video and the release itself.

Content Studio's `studio preview` (content-studio#127) consumes the contract below.

## Run it

From a Platform checkout whose dependencies are installed (`pnpm install`, or
`pnpm worktree:prepare` in a worktree):

```bash
pnpm --dir <platform checkout> preview:files --package <path> [--port <n>]
```

The first line of standard output is the address: `Preview: http://127.0.0.1:4400/`. Problems go to
standard error. `Ctrl+C` or `SIGTERM` stops the preview. The command reads files only; it writes
nothing outside the Vite dependency cache of `apps/web`.

| Argument | Meaning |
|---|---|
| `--package <path>` | Required. A `package.json`, a package directory, or the folder Content Studio exports packages into. In a folder, the package whose `package.json` was written last wins. A relative path is resolved from the directory the command was started in. |
| `--port <n>` | The port. Without it the preview takes 4400 or the next free port. `0` takes any free port. An explicit busy port is an error. |

The preview listens on `127.0.0.1` only: it serves the package files and signs the reader in as an
author.

## Input

The input is a package exactly as `python3 tools/content.py export-platform` in Content Studio
writes it: `package.json` in canonical JSON (schema version 1, 2 or 3) and the asset files it names
beside it. The preview loads it with the same checks as `authoring:release`, so a package the stand
would refuse shows the reason in place of the page.

```text
<export folder>/
  <package id>/
    package.json      the manifest: products, chapters, materials, tasks, Glossary Terms, assets
    assets/…          the files `assets[].path` names, with matching sha256
  <newer package id>/
    …
```

A lesson is a row of `materials`; a Task page is a row of `tasks` with its `page`. A lesson that
belongs to a product opens inside its course, with the programme of that product's chapters and
Tasks. Only what the package carries appears: a package with one chapter shows a course of one
chapter.

## Pages

| Address | Page |
|---|---|
| `/` | The package contents: links to every lesson and Task page. |
| `/materials/<material sourceId>` | The lesson in the site's reader. |
| `/products/<product slug>/tasks/<task sourceId>` | The learner's Task page. |

Any other address, including the programme and pages outside the package, shows the contents.

## Reload

The preview watches `--package`. When a file under it changes, it reloads the package and every
open page reloads itself. The preview reads packages, not the authored Markdown: the caller
re-exports when a source file changes. Content Studio writes each export into a new directory, so
`studio preview` exports into one folder on every save and passes that folder; each new export
replaces the shown package.

## What differs from the site

- The video shows the site's player frame and chapters with the Kinescope ID inside. The player
  needs a playback session that the backend opens with the Kinescope key.
- The reader is a signed-in author who has studied and saved nothing. Personal parts the backend
  supplies, such as the Telegram reminder, exercise attempts, ratings and submissions, are absent;
  a Task page does not accept submissions.
- Images are the package files at their own size; the site serves resized WebP copies.
- A lesson's date is today's, and its access is the one the package states.
