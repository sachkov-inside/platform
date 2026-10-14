# Content-only stand delivery and affected-image evidence

Use this procedure for an assigned content-only transfer to the existing local stand.
It preserves selected existing Material access and `draft`/`published` state, and Task access and publication state.
It does not approve a new access policy, public release, content acceptance, or learner progress.

## Preservation preview

1. Export the assigned committed Content revision with `exportCommittedPackage` from
   [`tools/authoring/git-local.mjs`](../../tools/authoring/git-local.mjs).
   Retain its exact `commit` and original `packagePath`; the supplied source SHA is an operator assertion about this export.
2. Use the stand's existing authoring gateway and state directory under
   [local authoring](local-development.md#local-obsidian-authoring-preview-468).
   Keep the singleton stand and its data under its current owner's control.
3. Set `AUTHORING_PRESERVATION_DATABASE_URL` privately to the stand's existing loopback PostgreSQL `inside` database.
   Do not put credentials in command arguments, receipts, Git, or logs.
4. Create the preservation preview:

   ```bash
   pnpm authoring:preserve preview --package PACKAGE_JSON --state STATE_DIRECTORY --commit SOURCE_SHA
   ```

The package itself defines the selected Material and Task source IDs. Unselected originals are not imported.
The profile queries only those identities in `materials.materials` and `product_tasks.tasks`.
Task code lookup also detects a conflicting source identity.
The database adapter uses a bounded, repeatable-read, read-only transaction.
It accepts only loopback PostgreSQL URLs without URL options and the database name `inside`.
The authoring API must independently report the same environment, Material identity/version/access/publication,
and Task identity/code/revision/publication. Task Product binding must match the authoring Product source identity.
Existing journal Material identities and versions must agree; stale journals require reconciliation first.

The profile copies fresh access choices and Task publication into a separately hashed package.
It selects only already published Materials for the existing release publication mechanism.
This selection preserves their publication state; it can replace their published body with the assigned content.
The original package remains unchanged. The profile does not use earlier task-local package or policy snapshots.

The returned immutable receipt binds source SHA, original/derived package IDs and paths, reviewed preview,
and fresh selected target state. Review the ordinary preview changes before applying this receipt.

## Apply and preservation proof

```bash
pnpm authoring:preserve apply --receipt PRESERVATION_JSON --state STATE_DIRECTORY
```

Apply checks receipt/package/preview bindings and fresh selected identities, versions, access and publication
before invoking ordinary release reconciliation. A changed guard requires a new preview.
Ordinary release fingerprint and optimistic version checks remain active.
Concurrent writes after preflight still follow those existing per-operation checks; the transfer is not an atomic database transaction.
After apply, the profile compares identities/access/publication again, allowing content revisions to advance.
Its immutable `.applied.json` links the original package, derived package, preview, before/after states, and apply report.
A failed post-apply proof requires inspection; it does not roll back a partially applied transfer.

The profile refuses these cases before release writes:

- Missing or ambiguous selected identities, inconsistent API/database state, stale Material journals, and pending release operations.
- New rows. Use a separately reviewed release with an explicit access/publication policy before using this preservation profile.
- Nonempty legacy `practiceDefinitions`. Use the ordinary release with a separately selected Practice policy.
- Existing `unpublished` Materials. Current Material import supports `draft` or `published`; the profile refuses to republish them.
- Product details/composition changes and import conflicts. Review those through the ordinary release workflow.

The wrapper never approves archives. Unselected journal archive proposals remain unapplied.
The profile preserves Material and Task policy and refuses legacy Practice definitions.
It never queries or edits accounts, subscriptions, submissions, or reading progress.
No production target, backend route, public API, Reader UI, Compose lifecycle, or publication policy changes belong to this command.

## Affected-image manifest

After the transfer, prepare image evidence from the applied package and its upload journal:

```bash
pnpm authoring:image-proof prepare --package DERIVED_PACKAGE_JSON --state STATE_DIRECTORY --spec SPEC_JSON
```

The spec contains these fields:

| Field | Required value |
|---|---|
| `sourceCommit` | Exact exported Content SHA |
| `columns` | One `desktop`/`wide` and one `phone`/`tall` entry, each with `viewportWidth`, `viewportHeight`, measured `columnWidth` |
| `images` | Each affected Material `sourceId`, package `sourceSrc`, and `titleRegions.wide`/`titleRegions.tall` |
| `titleRegions` | Reviewed title bounds as normalized `{ x, y, width, height }` within each image |
| `reusedEvidence` | Explicit links to unchanged earlier evidence; an empty array means no reuse |

Read title regions from the final PNGs. Measure columns from the actual Reader wrapper; do not substitute viewport width.
The manifest derives every selected scene's four variants, ALT, source paths, PNG hashes/dimensions,
and uploaded asset UUIDs from the package and journal.
It binds each case to desktop/phone, light/dark, expected variant, column, and `idle`/`hover`/`keyboard-focus` wrapper states.
This initial command supports PNG variants on Material pages. Task-page assets and non-variant images need their existing manual evidence.
An affected selection must identify one rendered image and nonempty ALT unambiguously.

The immutable manifest specifies observations; preparing it does not prove a browser rendered anything.
Use the existing browser tooling with the stand owner. Record the actual running Platform SHA and browser version.
Do not replace the stand's UI with another branch merely to obtain proof.

## Browser observation and check

Capture one observation per manifest case. Use the same browser state for its measurements and screenshots.
Select the intended theme explicitly. Await image decode, then inspect the actual image wrapper.
Observe the idle control, pointer hover, and keyboard focus separately. Open the viewer through the control.
Close the viewer and preserve the reader's state.

The observation JSON uses the schema in
[`tools/authoring/image-proof.mjs`](../../tools/authoring/image-proof.mjs):

- Top level: `manifestFingerprint`, `sourceCommit`, `packageId`, `platformSourceCommit`, `browser`, `reviewer`, and `cases`.
- Each case: manifest `id`, actual `theme`, viewport/column dimensions, `currentSrc`, `alt`, `decoded`, natural dimensions,
  `imageRect`, `pageOverflow`, `imageOverflow`, and three `controls` observations.
- Each control: `state`, actual `visible`, `focusVisible`, `opensViewer`, `controlRect`, screenshot path/hash,
  and independent `humanLegibility`/`humanTitle` decisions (`accepted`, `rejected`, or `pending`).

Image and control rectangles share viewport coordinates. `controlRect` describes the visible expand icon overlay,
not the full-image button's click target. Screenshots resolve relative to the observation file, unless absolute.
Check visible title and legibility at the actual column in each theme and control state.
Record `pending` until a human or visual reviewer has inspected the screenshot.

```bash
pnpm authoring:image-proof check --manifest MANIFEST_JSON --observations OBSERVATIONS_JSON
```

The check rejects wrong asset variants, theme/viewport/column mismatches, failed decode/aspect ratio/ALT,
overflow, missing wrapper states, failed focus/viewer controls, and expand-icon intersection with the specified title region.
It separately requires accepted title/legibility decisions, verifies the current immutable package,
and hashes the referenced screenshot files. It cannot prove the honesty of supplied browser measurements or human decisions.
Passing machine checks is not technical-semantic review, whole-lesson acceptance, or evidence of learner success.

Incremental proof covers exactly the declared affected images and names reused unchanged evidence.
Text-only edits without browser observations make no live-image claim.

## Focused verification

`pnpm test:authoring` includes mocked gateway/database preservation contracts and synthetic PNG proof cases.
They cover draft/published Material policy, drift before writes, missing identity, Task policy derivation and binding,
database scope/cleanup, correct/wrong variants, title collisions, and incomplete focus/human review.
These fixtures do not inspect the live stand. Complete Platform delivery with the
[verification evidence policy](../agents/release-evidence.md) and independent review.
