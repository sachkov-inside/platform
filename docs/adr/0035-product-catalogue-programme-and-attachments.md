# 0035: Separate Product catalogue, programme placements and chapter attachments

Status: Accepted

Date: 2026-10-16

## Context

The owner needs one global Material body with flexible reuse inside Products. Catalogue membership
previously also represented a single programme position. That prevented repeated placements and
required special navigation rules for reference documents.

## Decision

Keep Product catalogue membership unique per Material. Give each programme placement its own stable
identity and position, referencing a catalogue member and optionally a chapter. Allow repeated
placements within and across chapters. Preserve one global studied mark and body per Material.

Store ordered chapter attachments independently from programme placements. Attachments reference
catalogue members, including Materials already in the programme. They do not add mandatory steps.
Show only the current chapter's attachments in the sidebar, plus the active reference when needed.
The Product Materials tab remains the complete catalogue.

Platform can update attachment links for imported Products without modifying Content originals,
programme composition, import receipts or the authoring journal. Ordinary catalogue/programme edits
retain source ownership guards. Imports omitting attachment metadata preserve existing links.

Programme progress counts distinct programme Materials. Step navigation identifies repeated positions
in its URL; references preserve the originating placement. Existing standalone Material URLs remain valid.
All published free Materials appear in the feed; the legacy showInFeed value cannot exclude them.

## Consequences

Existing programmes gain stable placement identities through an additive migration. Flat Products retain their legacy automatic initial programme until the author explicitly saves placements; later catalogue edits and membership additions preserve that explicit programme. Reading state,
submissions, access grounds and artifact bindings remain unchanged. Removing a catalogue membership
removes its placement and attachment references through membership constraints.

A copied Material body was rejected because it would split study history and future edits. Slug-based
reference groups were rejected because they encode one course's editorial choices in application code.
Keeping catalogue membership as the programme position was rejected because it prevents independent reuse.
