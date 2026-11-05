# Content Studio snapshot, platform-package-v2

This file is the single contract authority for Content Studio's Platform adapter and Platform's
snapshot receiver. Content Studio links here instead of keeping a second v2 specification.
The v1 adapter contract remains supported: an ordinary authoring package still uses its existing
preview, release and content-preserving deliver paths. Snapshot contract versions and constituent
`schemaVersion` values are independent.

## Request and committed export

One `studio publish platform` prepares every ready course lesson, course assignment and article
from one full Git commit. Group course rows by their programme guide. Articles remain outside guides.
Sort groups and source IDs deterministically. Refuse uncommitted material changes, ambiguous source
IDs, missing access and missing course programmes. Do not create delivery commits.

The sender's request names `contract: platform-package-v2`, `target: platform`,
`receiver: production`, `commit`, sorted `guides`, `materials`, `tasks`, and `articles`.
`materials` includes lessons and articles; `articles` identifies their manifest format for read-back.
The dry run prepares this request without target writes. The owner's «выкладывай» authorizes one
snapshot apply, subject to the existing production confirmation.

The committed Content exporter implements:

```text
uv run --frozen python tools/content.py export-platform --snapshot --output DIRECTORY
```

It prints only the exported directory on stdout. That directory contains `package.json`, the
snapshot envelope, constituent packages and their assets. Platform runs this command inside its
private checkout of the named commit. It also exports HEAD and refuses changed selected content,
access, selection or Product context. A later commit changing only provenance commit fields passes.
No working-copy file enters either export.

## Envelope

Write canonical JSON: recursively sorted object keys, compact separators, UTF-8, no trailing newline.
The envelope contains only these fields:

```json
{
  "contract": "platform-package-v2",
  "commit": "FULL_40_CHARACTER_LOWERCASE_SHA",
  "entries": [
    {
      "id": "inside-ai-engineering",
      "path": "inside-ai-engineering/package.json",
      "sha256": "SHA256_OF_EXACT_PACKAGE_BYTES",
      "access": { "lesson-source-id": "paid", "assignment-source-id": "free" }
    },
    {
      "id": "articles",
      "path": "articles/package.json",
      "sha256": "SHA256_OF_EXACT_PACKAGE_BYTES",
      "access": { "article-source-id": "free" }
    }
  ]
}
```

Use one to 100 entries. Entry IDs are unique lowercase kebab identifiers. Paths are portable,
relative to the envelope directory. Neither traversal nor symlinks may escape that directory.
Each entry names an ordinary supported authoring package, never another snapshot.
Constituent assets keep the existing package containment and checksum rules.

Each selected namespaced identity appears once across the snapshot, including across Material
and Task kinds. Task codes and namespaced Product contexts cannot repeat between entries.
Each Task's provenance commit equals the envelope commit. Legacy Practice writes require a
separate migration and are refused in a snapshot.

`access` names exactly every selected Material and Task of that entry by source ID. Values come
from Studio manifests. `free` means Platform `free`; `paid` means Platform `closed`.
The receiver derives an executable package with those access values and keeps original bytes.
The normal Product membership, permission and protected-video rules still apply. A closed Material
must belong to a Product. A standalone article without a Product therefore must be free.
This contract does not introduce a paid standalone entitlement.

## Constituent packages

Export each course with the existing guide exporter. Its course package must remain byte-identical
to the v1 course export at that commit, except fields that record the commit. Do not rewrite its
access, authored content, programme, assets, source IDs or package schema to build the envelope.
The envelope's access map carries the Studio access decision separately.

An existing course's bounded `selection.contentOnly` retains the complete guide as read-only context.
Only its selected Materials and Tasks receive changes. Bounded packages retain the existing refusal
of creation, placement changes and conflicts. Creating a course or changing its programme still
requires its ordinary full release package and explicit review. Snapshot v2 does not weaken that gate.

Standalone articles use an ordinary Material package with `selection.guideId: null` (historical
schema) or `selection.productId: null`, no Products and no Tasks. Its selected Materials are exactly
the ready articles. It has no `contentOnly`; the normal release creates new Materials or updates
existing Materials. `access` owns access; `inFeed` remains the existing explicit feed choice.
Snapshot publication does not automatically place an article in the feed.

## Receiver commands

Pass the envelope path as `--package` to either interface:

```text
pnpm --silent authoring:deliver preview --target production --package PACKAGE_JSON --commit CONTENT_SHA --content-repository CONTENT_REPOSITORY --state STATE_DIRECTORY --material ID... --task ID...
pnpm --silent authoring:deliver apply --receipt RECEIPT_JSON --state STATE_DIRECTORY
pnpm --silent authoring:release preview --target production --package PACKAGE_JSON --commit CONTENT_SHA --content-repository CONTENT_REPOSITORY --state STATE_DIRECTORY
pnpm --silent authoring:release apply --preview PREVIEW_JSON --state STATE_DIRECTORY
```

`authoring:deliver` requires exactly the union of selected Material IDs and Task IDs in its repeated
flags. This repository has no separate `authoring:preview` command; release preview and deliver
preview are the supported preview interfaces. Both snapshot interfaces publish selected rows.
An ordinary v1 deliver continues to preserve target access and publication.

Preview verifies all package bytes and the committed export before preparing every constituent
release preview. It performs no target writes. Apply binds the envelope, packages, target and every
child fingerprint. It compares every child plan again before the first new write. Each child then
uses the ordinary release's version, ancestry, authorization and idempotency checks.
Omission never authorizes archive. Snapshot apply accepts no archive choices.

A snapshot is one owner action, not a database transaction. Entries apply sequentially. A later
failure can leave earlier entries applied. Keep the release journal and original evidence.
Complete any pending operation through the existing release recovery procedure, then preview the
whole snapshot again. Already matching rows become unchanged. Never report a failed snapshot as
fully delivered and never reconstruct unknown write outcomes from local guesses.

## Read-back

After each constituent apply, Platform compares it again and requires every selected row to be
unchanged. It reads authenticated receiver state and returns `delivered` only after the complete
snapshot succeeds. Each row has:

| Field | Meaning |
| --- | --- |
| `kind` | `material` or `task` |
| `sourceId`, `sourcePath` | Original source ID and source path |
| `status` | `applied` or `unchanged`, relative to the reviewed preview |
| `revision` | Receiver Material contentVersion or Task revision |
| `sourceCommit` | Commit actually recorded by the receiver; nullable for historical unchanged Materials |
| `origin` | Receiver target |
| `recordedAt` | UTC time of read-back |

The sender resolves Material IDs using its prepared lesson/article mapping, rather than treating
every Material as a course lesson. Task IDs resolve to assignments. Write the existing delivery
record fields into the corresponding Studio manifest only for these confirmed rows. Preserve
`sourceCommit: null` as unknown history instead of inventing a commit. These manifest records are
not new delivery commits. Raw receipts remain local and ignored.

Production application release and deployment remain owned by Platform's normal release process.
Publishing a Content snapshot does not deploy Platform code.
