# #1378: Material attachment viewer proof

The owner narrowed #1378 on 2026-10-13 to files attached directly to a Material.
This synthetic Storybook proof tests an inline reference, file explorer, source preview,
exact copying, individual downloads and a ZIP. It has no production route or storage adapter.

The earlier PR #1379 at `cbd9ab5e0933a136c9f211afb1f11ff039c08ddd` remains
unaccepted historical evidence. This proof branches from that head to preserve preview6009;
its PR targets the previous prototype branch so reviewers see only the new proof.
Neither prototype branch is a production integration target.

## Preview

- [Inline reference](http://localhost:6009/?path=/story/prototypes-materials-attachment-viewer--in-material)
- [Desktop viewer](http://localhost:6009/?path=/story/prototypes-materials-attachment-viewer--viewer)
- [Mobile viewer](http://localhost:6009/?path=/story/prototypes-materials-attachment-viewer--mobile)

Five stories cover the material, open viewer, mobile, one file and an empty set.
Markdown displays its exact source. An unsupported `.drawio` file offers a download.

## Captured evidence

- `material-desktop.png`: inline reference in the real public application shell, 1440 × 1000.
- `viewer-desktop.png`: file explorer and selected JSON source, 1440 × 1000.
- `viewer-mobile.png`: readable source and collapsed selector, 390 × 844.
- `files-mobile.png`: expanded file selector, 390 × 844.

Browser checks verified exact clipboard text, file switching, Escape focus restoration,
mobile selector dismissal, unsupported preview and no dialog overflow at 200% text size.
The ZIP was decoded and all four entries matched the individual fixture bytes and paths.
TypeScript, focused lint and documentation checks passed before review.
Full `pnpm check`, Storybook tests and independent review are recorded in the linked PR;
a queued or running check is not a pass.

## Remaining gate

Owner visual acceptance is pending and must be relayed through the launch coordinator.
Acceptance question: does the inline reference and file explorer provide the intended
Material attachment viewing experience on desktop and mobile?
Production authoring, import, protected text delivery and ZIP generation remain future work
under #1378. Keep existing MaterialAsset ownership and ContentAccess.
The owner-managed course session wWW is outside coordinator control.
