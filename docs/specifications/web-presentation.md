# Web presentation

Accepted owner decisions on Reader controls, the course frame, mobile control density and site
animation in `apps/web`. Standards review checks UI changes against this specification; the owning
issues and evidence keep the history.

## Site animation

- Build site animation as a page-local CSS component using platform tokens and `lucide-react`.
  The static cover stops the same component's loop. Support `prefers-reduced-motion`; change scenes
  without morphing objects. Embedded video is not a site asset. Owner decisions and rationale:
  [#614](../evidence/issue-614/ai-first-animation/README.md).
  The owner-approved [#808 exception](../evidence/issue-808/animation/README.md) uses a
  pure time-driven canvas, a dark card moving between episode states, no pause button and the final
  frame under reduced motion. Its course page and Home card use duotone Phosphor geometry from
  `apps/web/src/features/ai-engineering-course/ui/course-icons.tsx` instead of `lucide-react`.

## Reader controls

Owner decision #1591 (accepted prototype A, desktop and mobile): Material action panels group
Back, Save, Studied and Share at the left, with Next at the right. Repeat the same panel before
the title and after practice/workspace, before course navigation. Omit Next when no successor
exists. Preserve the computed Back destination, canonical sharing address and existing mutation
adapters. The article has no automatic contents disclosure.

Use 44 px controls with 16 px icons, 14 px labels and a 54 px panel at normal text size.
Allow the panel and action group to wrap whenever enlarged text, recovery actions or narrow
embedding cannot fit one row. Keep accessible names when labels
become visually hidden. Desktop shows labels; below 64rem viewport width or at most 620 px panel
container width, hide Save/Share labels. At most 390 px container width, hide Studied's label;
at most 290 px also hide Back/Next labels. The accepted 390 px phone view keeps Back/Next text.
Compact study controls remain ghost buttons; saved actions use the existing semantic state tokens.
Both panels share saved state, pending commands and failures. Loading/access frames reserve the
same top panel geometry. Share feedback and its manual-copy field appear beside the activated panel.
These rules supersede the earlier #1336/#1362 action-panel layout and sizes only.

The existing lesson navigation and typography remain unchanged:

| Reader element | Phone size |
| --- | --- |
| Floating standalone lesson pager | 146 × 46 px; 44 px arrow controls |
| Standalone title / prose | 22 px / 15 px |
| Quiz heading, question and choices | 14 px |

The reading button keeps its geometry and the reader's scroll position while saving. Use the
shared fast motion token for press feedback and a crossfade between unread and saved icons;
do not spin the icon. Keep the current saved state until the command succeeds, expose pending
with `aria-busy` and the status message, and remove transitions under reduced motion.

- Keep touch targets at least 44 px high. Size ordinary action buttons to their labels with
  12 px horizontal padding and 8 px gaps; do not add a fixed broad width or oversized vertical
  padding. Full-width actions need a named layout reason.
- In checked programme context, Course B supplies the course frame (#1414, owner 2026-10-13):
  a 272 px left chapter rail, position/title, the matching Material action panels, and
  a desktop previous/next footer with neighbor titles. Reserve this composition in shared pending and
  access states. Owner correction 2026-10-15: below 48rem, phones use a floating rounded lesson dock without backdrop blur
  with previous/next arrows, chapter/step position and a programme opener. Its bottom sheet leaves
  a dismissible top gap and expands the current chapter. Close the sheet on navigation, route hide
  and desktop resize. From 48rem to below 64rem, a top button opens a left modal drawer;
  omit the bottom dock and retain the previous/next footer. At 64rem the rail stays visible.
  Prose uses 16 px below 80rem and 18 px above; retain 15 px phone prose.
  Keep the mobile course heading at 20 px; omit format, course and topic metadata.
  Rail rows and chapter selection use 16 px and 1.6 line height. Keep step titles at weight 400
  in every selection state so their wrapping stays stable. Distinguish the current step with
  foreground text and a subtle action-coloured glow at its left marker; omit selected-row fill
  and visible status badges.
  Strike through a Task title only when its persisted submission timestamp is present, including
  the currently open Task. Keep the submitted state accessible without a visible label or date;
  an unsent review report does not count as a submission or imply acceptance by the author.
  Chapter options use a subtle muted background for pointer and keyboard highlight, without
  underlines or a surrounding focus ring. Retain the selection check and a forced-colors focus
  outline. Allow the chapter menu up to 32rem within available viewport height.
  Chapter titles wrap without clipping the chevron.
  The header shows the authored chapter ordinal and its mixed step position/count. Keep the legal
  footer only on course landing, purchase, payment and legal routes. Navigation rows make no personal access claim from guest-cached composition; target
  routes retain their access gates. Material ordinals/progress stay separate from mixed positions.
  Save, error, denial,
  unavailable, protected-body and standalone behavior remains unchanged.
- Outside checked programme context, keep the existing floating lesson pager and its one-line
  lesson number. The action panels follow #1591 above; the pager retains adjacent-lesson and
  programme navigation. Do not add a separate ordinal or product heading beneath the material.
- Outside checked course context, use 22 px on phones for the Reader title and 15 px with a 1.65 line height for its
  prose. Keep the established desktop sizes from their breakpoints. Learning outcomes remain in
  metadata and the editor; the reader has no outcomes panel.
  Reader headers omit the Material summary, including loading and access states
  (owner correction 2026-10-13).
- A collapsed callout is one 44 px summary row; put body padding only inside its open content.
- On phones, quiz titles, questions and choices use 14 px with compact padding; from `sm` they use 16 px.
- A quiz uses the shared semantic result colors, a result icon and a written result. A person
  can change the answer directly; do not repeat the selected text or add a separate retry button.

The 44 px choice preserves comfortable touch targets while reducing visual bulk;
[W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced)
explains the enhanced size criterion. These sizes apply to Reader; they do not change other page
typography.

## Mobile control density

Owner correction 2026-10-12 (#1362): use a 36 px visible footprint for ordinary phone actions,
16 px action glyphs and choice indicators, and at least 44 px touch extent. Shared Button owns
the compact phone override for ordinary actions; small editor tool variants keep their size.
Multiline actions grow instead of clipping. Desktop sizing remains owned by each component.
Owner decision 2026-10-22: top-header controls use 20 px glyphs at every width, so header icons
match; a header Button opts out of the phone override with `data-glyph="header"`.
Keep input text at 16 px on phones; ordinary fields stay at least 44 px. Decorative artwork,
avatars and illustrations do not follow action-icon dimensions.

Course Material headers omit publication dates (owner decision 2026-10-14). Keep persisted dates unchanged. Course Task headers show chapter and step without task, product or requirement-version labels. Submission status belongs to the submission section, not the header. Keep requirement versions in submission validation and history.
