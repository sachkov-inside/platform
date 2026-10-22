# Local authoring preview

One-shot import of Engineering Content originals into a local target.

## Local Obsidian authoring preview (#468)

For content-only updates that must preserve existing stand access/publication and prove affected images,
use [the preservation and image-evidence procedure](authoring-preservation.md).

Originals from Engineering Content reach a local Platform through a one-shot import of one Git commit.
Two loopback targets exist, each with its own state directory:

| Target | Runtime | Gateway |
|---|---|---|
| `editor` (default) | `pnpm editor:local` with a synthetic owner | the editor runtime itself on `127.0.0.1:4396` |
| `stand` | `pnpm local:stand` with sign-in, purchases and mail | `pnpm authoring:stand-gateway --owner-email EMAIL` on `127.0.0.1:4398` |

For the stand, normal launch prepares the local owner with full permissions (see
[local accounts](local-stand-accounts.md#local-account-boundary-and-recovery-1641)); the authoring gateway reuses that email. The stand bootstrap registers the
stand-only Logto client `Inside Authoring Stand` with token exchange; the gateway creates the
owner's stand personal access token in `.identity-proof/authoring-owner-pat.json` and exchanges it
for short API tokens, renewing the stored token once when the stand's sign-in database was
recreated. It forwards only canonical `/authoring/` API paths from non-browser clients; any process
on this machine can act as the stand owner while it runs, so stop it after the transfer.
Run the stand from a worktree only as [Local product view](local-stand-accounts.md#local-product-view) describes: a fresh
bootstrap there would generate new sign-in keys for the owner's stand accounts.

```bash
pnpm authoring:sync-git-local CONTENT_REPOSITORY PRODUCT_ID STATE_DIRECTORY [REF] [--target editor|stand] [--publish SOURCE_ID]... [--publish-all] [--archive SOURCE_ID]...
```

`REF` defaults to `HEAD` and is resolved to one commit SHA before export. The command checks out
that commit in a temporary private clone with its own index and Git provenance, runs its exporter with frozen dependencies, and applies
the resulting package. Staged, unstaged and untracked files are excluded. The owner’s checkout is
not modified; no commit, push, Git hook or file watcher is involved. Immutable packages remain under
`STATE_DIRECTORY/packages`; `last-git-sync.json` records the last successful commit, package and
report. After an error, rerun the same commit: the journal resumes partial application.
Refresh the browser after a transfer; report links point at the reader origin of the target.

The opt-in `--course-preview` profile validates the current eight-chapter AI Engineering outline
before applying the existing local access policy: first-chapter Materials free, other Materials closed.
It preserves Task access and the original immutable package. Programme-only updates use the shell
scope described below and do not invoke this access profile.

What the transfer applies:

- Material text, images, links, access, topic, feed choice and product membership. Editorial SVG
  diagrams are rasterized to PNG for the image upload boundary; the source package keeps its SVG. Paid Materials
  validate inside their product; `supplementary_materials` join the product after the programme
  without a chapter, which is its "Additional Materials" part.
- Material covers through `PUT /authoring/import/content-covers/material/:id`, and the product
  cover (`guide.yaml` keys `cover` and `cover_alt`) through
  `PUT /authoring/import/content-covers/series/:id`; a cover removed from the original is reported
  as the `cover_removal_pending` notice and taken down in Platform by hand. Material
  artifacts as authoring-owned Product artifacts linked to every declaring Material that is published.
  Each `materials[].artifacts[]` package entry may carry `filename`, such as `customer-brief.md`;
  packages without it keep their stored asset basename. Authoring Markdown may reference a declared
  artifact using `[Скачать бриф (.md)](artifact:aie-customer-brief)`. The importer resolves the
  package's stable artifact ID into the local protected current-file route. Do not author UUIDs,
  signed storage URLs, environment addresses or fixed file versions in Content. Keep the ordinary
  link for reading the Material separate. These artifact declarations require the ordinary reviewed
  release; the content-only preservation wrapper does not apply Product artifact state.

- An existing provider record named by `platform_video.kinescope_id`: attached, reconciled until
  ready and saved with the original's video chapters.
- The Product name, first-paragraph teaser, page address (`slug`), page presentation and the typed
  product page description (`guide.yaml`, key `page`; see
  [ADR 0026](../adr/0026-guide-page-from-source-data.md)). Platform checks the presentation and the whole
  page description before the transfer's first write, and its refusal names the product.
  The optional `products[].introduction` imports all four introduction fields; omitting it preserves
  the stored introduction. The source owns this text for imported Products (#845).
  Editing the page text is a commit in Engineering Content plus a transfer, with no web rebuild.

Publication is an explicit owner decision (#804). By default every original is transferred as a
private draft: its author previews it through the authoring preview, while guests, other accounts,
search, the feed, the product programme, assets, practice and the learning MCP do not see it. An
editorial `stage` or a missing `access` never publishes or protects anything by itself.
`--publish SOURCE_ID` (repeatable) or `--publish-all` approves publication for that transfer; a
repeated transfer without the approval keeps drafts private; an approval is not remembered, so a
later transfer names a published Material again to update it. A private transfer checks every
Material's own state on the target before its first topic, Product or Material write and stops when
one is already published or unpublished: it neither takes a public Material back nor replaces its
public body (Platform itself never returns a Material to draft). An interrupted transfer that was
publishing a Material resumes only when the next run carries the same approval. A Product artifact declared only by private drafts
waits for a published owner, a practice of a private lesson is imported unpublished, and a published
body that links a private draft is reported as `link_to_draft`. A private draft that leaves the
package is never proposed for archive.

Imported Materials and Products change only through these source-scoped routes; ordinary editor,
API and MCP writes are refused. A missing original appears in `archiveProposals`. It is unpublished
and removed from the product only when the same command repeats with `--archive SOURCE_ID`.
Proposals cover Materials previously transferred with the selected product; a standalone original
is never proposed, because an explicit Material selection does not describe the whole catalog.
Journal entries written before products were recorded carry no product and are proposed for any
product selection; confirm each one before naming it with `--archive`.
`authoring:release preview` marks a Material with a Video whose access changes as a conflict: the
Video keeps the access it was attached with, so that change needs a separate recording decision.

A finished recording for a synchronized Material is uploaded with
`pnpm authoring:video upload --state STATE_DIRECTORY --source inside-content:MATERIAL_ID --file FILE`.
The idempotency key is journaled before the first call; an unknown outcome stops for inspection.
Only the test Kinescope adapter, whose upload endpoint ends in `.invalid`, is accepted; a real
provider transfer is refused without a separate owner approval. The next transfer saves the
recording with the original's chapters; the returned `providerVideoId` belongs in the original.

A package with `selection.scope: "product-shell"` releases only a product's page, card, summary and
complete chapter list, without any Material (#803). It keeps the Materials the target already holds
in their order and chapters, proposes no archive and refuses `--archive`; an empty selection without
that scope is refused. The [Product shell contract](../contracts/authoring-guide-shell-v1/README.md)
describes the package the Content exporter writes.

`pnpm authoring:release preview --package PACKAGE_JSON --target editor|stand --state STATE_DIRECTORY [--publish SOURCE_ID]... [--publish-all] [--task-access CODE=free|closed]... [--confirm-product-removal PRODUCT_UUID]...`
compares a package with the target without writing and saves a fingerprinted preview. Each Material
shows its `publication`, a `publicationChange` from draft to published, or the conflict
`target_not_draft` for a private import of a published or unpublished Material; the approval is part of the preview,
so `apply` publishes exactly what was reviewed. A Material missing from this state directory's
journal appears as `new`, because Platform offers no read-only lookup by source key; `apply` still
checks its real state before any write.
Course package v2 declares `requiredFeatures`; unsupported features stop before writes or asset
uploads. This importer supports `task-c-v2`, `github-anchors-v1`, `image-variants-v1`,
`collapsible-callouts-v1` and `quiz-v1`. Content quiz `readerBlocks` take precedence over raw Markdown;
quiz shape and narrative review anchors are validated before asset uploads. A Task with `access: null` is a preview conflict
until `--task-access CODE=free|closed` records an explicit choice. Repeat the option for each Task;
unknown codes or conflicting choices are refused. Apply reads the saved preview choice, so it takes
no `--task-access` and does not change package bytes. An existing Material with the Task source key
is a migration conflict; apply does not replace, archive or duplicate it.

For an explicitly reviewed removal from a held Product, repeat
`--confirm-product-removal PRODUCT_UUID` on **preview** (#1302). Each UUID must identify an active
Product of this package on this target. The sorted `confirmedProductRemovals` choice enters the
saved preview fingerprint; apply reads it from that preview and accepts no choice flag. Each
composition command receives only its own confirmed Product ID. Without that choice, removing a
published Material from a held Product still fails with HTTP 409
`product_removal_confirmation_required`; Materials remain published.
After a definitive rejection during partial apply, make a new preview against the actual target
state with the explicit choice. Composition commands use journal operation keys derived from their
stored request: the changed choice gets a new key, while old rejected operations and previews stay
unchanged. If an earlier successful receipt differs from the current order version, a new operation
applies the composition again and preserves the old receipt. Materials and Tasks already applied resume through their existing journal receipts.
An unfinished composition retries its original payload and key with the same reviewed choice.

`pnpm authoring:release apply --preview PREVIEW_JSON --state STATE_DIRECTORY` first completes any
write the journal left unfinished, with its original idempotency key, then applies exactly that
preview and stops on drift, an edited preview or an unreviewed archive request. Drift covers
Material versions, each Product's version and its programme order, so a page edited on the target
after the review is not overwritten; a preview also lists added and removed chapters. The only
non-local target is the trusted `production` target, reached with the owner's one-time sign-in; see
[Content production delivery](content-production-delivery.md). Every other address is refused.

```bash
pnpm authoring:products [--target stand|editor] [--owner-email EMAIL] [--json]
```

Lists every product of that environment: permanent source key, current address, presentation, the
state of its page description (`stored`, `none`, `rejected`), Home pin and lesson count. For the stand it reuses a running authoring gateway or starts one for the
listing and stops it afterwards.

`pnpm test:authoring` verifies package checks, conversion, recovery, covers, artifacts, video,
archive and release decisions. Evidence is in [the checkpoint](../evidence/issue-468/README.md).
