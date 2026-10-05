# Domain docs

Read [`docs/product/platform-mvp-brief.md`](../product/platform-mvp-brief.md) for the canonical
Platform product scope. Platform and Telegram share this repository; also read root `GLOSSARY.md` and
relevant `docs/adr/` entries. Telegram-local terms and ADRs live under `apps/telegram`. Their absence is not a setup failure:
`domain-modeling` creates them lazily when durable terminology or a hard-to-reverse trade-off is
actually resolved.

For shared Inside product scope, read [the Inside brief](../product/README.md); for legal editions
and their status, read [the legal index](../legal/README.md). Root `GLOSSARY.md` owns shared Inside
terms and Platform refinements; `apps/telegram/GLOSSARY.md` owns Telegram-local terms.
[The repository map](../../REPOSITORIES.md) names the current transition boundaries;
[the migration map](../migrations/958-shared-documents.md) preserves source provenance and history.
Record each Platform-specific consequence of a shared decision once:

- product scope in `docs/product/platform-mvp-brief.md`;
- an implementation contract in the technical specification;
- a hard-to-reverse technical trade-off in an application ADR.

For Material/Series authoring or Git preparation handoffs, also read the
[editorial/publication boundary](../product/platform-mvp-brief.md#контент) and
[Series composition contract](../specifications/platform-v1.md#series-step-sequences).

Keep build, test, deploy and agent runtime dependent only on files in this repository.
