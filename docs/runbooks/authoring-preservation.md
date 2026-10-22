# Content-only delivery and affected-image evidence

Use this procedure to update selected existing Materials and Tasks from Content Studio on the stand
or in production (#1672). It replaces their content and keeps what the target holds: Material access
and `draft`/`published` state, Product membership, Task access, publication and placement.
It does not create rows, archive, change Products or artifacts, approve a new access policy,
publish, accept content, or touch accounts, grants, submissions and reading progress.
Creation, archives and Product changes use the full reviewed `pnpm authoring:release`.

Content Studio owns the export, its `content.py deliver` command and its delivery records.
Platform owns this entrypoint and the receiver.

## Requirements

- A Platform checkout at a merged `main` revision whose receiver is deployed on the target.
  The minimal revision is the merge of #1672; the receiver reports import contract `1`.
- Node exactly as pinned in [`.node-version`](../../.node-version). Another version is refused
  with `node_version`; run the command through it, for example
  `fnm exec --using 26.10.0 pnpm --dir PLATFORM_CHECKOUT --silent authoring:deliver ...`.
- An immutable package exported from one committed Content revision, with package v2 feature
  `bounded-content-v1` and `selection.contentOnly` naming the selected Materials and Tasks.
  The package keeps the full Guide context for links, embedded Tasks and positions; only selected rows are written.
  `artifactIds` must stay empty.
- The Content repository that holds that commit, so history can be compared.
- One state directory per target. It holds the journal, derived packages, previews, receipts and proofs.
  Never share it between targets or reset it.

## Command

Every command prints one JSON document on stdout and exits `0` on success, `1` on a refusal or failure and
`2` on wrong usage. A failure document is `{ "ok": false, "error": { "code", "message" } }`; branch on `code`.

```bash
pnpm --silent authoring:deliver preview --target stand|production --package PACKAGE_JSON \
  --commit CONTENT_SHA --content-repository CONTENT_REPOSITORY --state STATE_DIRECTORY \
  [--material SOURCE_ID]... [--task SOURCE_ID]... [--owner-email STAND_OWNER_EMAIL]
pnpm --silent authoring:deliver apply --receipt RECEIPT_JSON --state STATE_DIRECTORY [--owner-email STAND_OWNER_EMAIL]
pnpm --silent authoring:deliver reconcile --target stand|production --state STATE_DIRECTORY \
  --namespace SOURCE_NAMESPACE [--adopt SOURCE_ID]... [--owner-email STAND_OWNER_EMAIL]
```

`--material` and `--task` must name exactly the package's `selection.contentOnly`; the repetition is the
caller's explicit statement of what it delivers. `CONTENT_SHA` names the commit the package was exported from;
preview checks that claim (see [History guard](#history-guard)). The package names its Guide in `selection.productId`.

### Preview

Preview writes nothing to the target. In order it:

1. checks the Node version, the selection and the package;
2. exports the Guide from `CONTENT_SHA` and from the repository's `HEAD` with the official exporter and compares
   the selected rows (see [History guard](#history-guard));
3. connects to the target (see [Connection](#connection));
4. reads `GET /authoring/import/materials/environment`, requires the expected runtime mode and import
   contract `1`, and requires every package feature to be listed by both the receiver and this client
   (`receiver_contract_missing`, `receiver_contract_mismatch`, `package_feature_unsupported`);
5. reads the target state of the package namespace through `GET /authoring/import/materials/state` and
   `GET /authoring/import/tasks/state` (permission `materials:manage`), and cross-checks each selected
   Material with `GET /authoring/materials/{id}` and each Task with `POST /authoring/import/tasks/validate`;
6. requires the journal to know each selected Material with the target's identity and version
   (`journal_missing`, `journal_identity_missing`, `journal_stale`: see [Reconciliation](#reconciliation));
7. refuses an older or diverged Content commit (see [History guard](#history-guard));
8. derives a package whose access and Task publication come from the target, previews it with the ordinary
   release, and refuses new rows, conflicts, Product or artifact changes, membership changes, Task placement
   changes and any access or publication change.

The success document contains `receiver` (target, mode, contract), `connection`, `sourceCommit`, `contentHead`, the original
and derived `package`, `selection`, the immutable `receipt` path, the release `preview` path and fingerprint,
`rows` and `hasChanges`. Each row names `kind` (`material` or `task`), `sourceId`, target `id`,
`change` (`changed` or `unchanged`), the preserved `access` and `publicationState`, the target version or
revision and `sourceCommit` with the target's recorded commit and its `relation` to the package.
Review the rows; when `hasChanges` is `false` there is nothing to apply.

### Apply

Apply takes only the receipt. It rechecks the contract, the receipt, package and preview bindings and the
fresh target state; a change since preview stops before any write (`target_changed`). It then applies exactly
the reviewed release preview, whose fingerprint and optimistic version checks stay active. Each written Material
records `source.commit`.

A write whose answer was lost stays pending in the journal, and preview refuses with `journal_pending`.
Repeat `apply` with the same receipt: it completes the pending writes once with their original idempotency keys,
writes nothing new and refuses with `journal_completed`. Then preview again; the completed rows show as
`unchanged`. Never reset the journal or retry with a new key.

After the writes it reads the state again and requires identical access, publication, membership and placement
(`preservation_failed`), then previews the same package once more and requires every row to be `unchanged`
(`verification_failed`). The immutable proof `PRESERVATION.applied.json` binds the receipt, before/after state,
the apply report and that verification; the success document repeats `proof`, `applied`, `unchanged`,
per-row version and commit changes and `verification`. A failed proof needs inspection; it never rolls back.
The transfer is not one database transaction: concurrent edits are caught by the per-operation version checks.

## Connection

For `stand` the command owns the authoring gateway on `127.0.0.1:4398`. It asks the port for the gateway's
identity (`GET /__local-api/gateway`): a gateway of the same owner is reused and left running; a free port gets a
gateway for the duration of the command, stopped afterwards. Any other process on the port is refused
(`gateway_port_busy`, with its PID when `lsof` finds it), as is a gateway acting for another owner.
The stand owner's email comes from the gateway's stored token file or `--owner-email`. Each target admits one
delivery at a time on this machine through `~/.inside-authoring/<target>-session.lock` (`target_busy`), so one
delivery never stops a gateway another delivery uses. `pnpm local:product` does not take this lock; do not run it
during a delivery. The stand itself must
already run under its [singleton owner](local-development.md#parallel-worktrees-and-singleton-ownership);
the command never starts, rebuilds or stops Compose services.

For `production` the command uses the owner's Keychain session from `pnpm authoring:login --target production`
(`owner_session` when it is missing or revoked); the session lock keeps two deliveries from rotating one refresh
token against each other. It resolves the API and sign-in
hosts first and prefers IPv4 answers, which is all the production edge publishes. A VPN fake DNS answer
(`198.18.0.0/15`) is refused with `network_fake_dns`: exclude `sachkov.dev` from fake DNS in the VPN
(real-IP or direct rule) and repeat. Reads without any HTTP answer are retried twice; writes are completed by
the journal with their idempotency keys. No relay, resolved-IP adapter or certificate override is supported.

## History guard

On 2026-10-19 an older prepared package replaced a newer production article. Three checks stop that before any write:

1. The official export (`exportCommittedPackage`) of `CONTENT_SHA` must produce the same selected Materials
   (text, metadata and their images, compared by source revision) and Tasks as the package
   (`package_commit_mismatch`). A stale package named with a current commit fails here.
2. The export of the Content repository's `HEAD` must produce the same selected rows unless `HEAD` is
   `CONTENT_SHA` (`source_newer_in_repository`). Later commits that change other files do not block.
3. A Material records the Content commit of its last import (`source.commit`); a Task version records its
   provenance commit. The package commit must equal the recorded commit or descend from it
   (`source_commit_older`, `source_commit_diverged`); a commit the repository does not contain is an error.
   A row whose content came from an import that named no commit reports `relation: "unrecorded"`; checks 1 and 2
   still apply to it, and its first delivery records the commit.

These checks guard against mistakes by an operator who already holds `materials:manage`; they are not a security
boundary. The receiver authorizes each write by that permission alone.

The full `authoring:release preview` applies the same rule to Materials. With `--content` it uses the exported
commit; a ready `--package` names it with `--commit CONTENT_SHA --content-repository CONTENT_REPOSITORY`.
A Material with a recorded commit is a `source_commit_unknown` conflict when the release names no commit, and
`source_commit_older` or `source_commit_diverged` when history goes back or sideways. An import without a commit
clears the recorded commit, because the content then comes from no known revision.

## Reconciliation

The journal of a state directory may not know every Material the target holds: on 2026-10-22 the production
journal knew 33 of about 70. `reconcile` compares the journal with the target state of one namespace and writes
nothing to the target. Each Material row has a status: `agree`, `target_only`, `journal_only`,
`identity_differs` or `version_differs`; `counts` sums them. Each Task row compares the revision of the journal's
`task:<code>` receipt with the target: `agree`, `target_only` (no receipt) or `version_differs` (another journal revised
it; a release refuses it as a conflict) or `receipt_invalid`; `taskCounts` sums them.

`--adopt SOURCE_ID` records the target's identity, version, access, publication and Reader path for that
Material in the journal, or the target revision in a Task's receipt, with an `adopted:<source key>` receipt naming the previous entry. Adopt only rows the
owner assigned for delivery after reviewing the report. An adopted row previews as `changed` once, because its
digest is unknown. Never adopt by hand-editing the journal, and never adopt a `journal_only` row.

## Refusals that keep the full release

Content-only delivery refuses, before writes: missing or ambiguous identities, pending journal operations,
existing `unpublished` Materials, nonempty legacy `practiceDefinitions`, Product shells, Product details,
composition or artifact changes, membership changes, Task placement changes and import conflicts.
Use the full reviewed `pnpm authoring:release` with an explicit policy for those.

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

`pnpm test:authoring` covers the entrypoint against an in-memory production receiver and a temporary Content
repository: missing journal, explicit adoption, preview, apply, post-apply verification, context links from the
target, the history guard in delivery and in the full release, and refusals before any request. It also covers
the contract handshake, the Node pin, fake DNS detection, read retries, draft/published Material policy, drift
before writes, Task policy and placement, and the synthetic PNG proof cases. `pnpm test:tooling` covers the
gateway identity probe. The backend integration tests cover the contract and state reads.
These fixtures do not inspect the live stand or production. Complete Platform delivery with the
[verification evidence policy](../agents/release-evidence.md) and independent review.
