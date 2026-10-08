# Domain docs

- Platform product scope: [`docs/product/platform-mvp-brief.md`](../product/platform-mvp-brief.md).
- Shared Inside product scope: [the Inside brief](../product/README.md). Legal editions and their
  status: [the legal index](../legal/README.md).
- Terms: root `GLOSSARY.md` owns shared Inside terms and Platform refinements;
  `apps/telegram/GLOSSARY.md` owns Telegram-local terms.
- Decisions: `docs/adr/`; Telegram-local ADRs live in `apps/telegram/docs/adr/`. A missing glossary
  or ADR is not a setup failure: `domain-modeling` creates it when a durable term or a
  hard-to-reverse trade-off is resolved.
- Repository owners: [the repository map](../../REPOSITORIES.md). Source provenance and history of
  the shared documents: [the migration map](../migrations/958-shared-documents.md).
- For Material/Series authoring or Git preparation handoffs, also read the
  [editorial/publication boundary](../product/platform-mvp-brief.md#контент) and the
  [Series composition contract](../specifications/platform-v1.md#series-step-sequences).

Where each changed fact is recorded: the [documentation maintenance contract](documentation-maintenance.md).
