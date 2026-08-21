# Domain docs

Read [`docs/product/platform-mvp-brief.md`](../product/platform-mvp-brief.md) for the canonical
Platform product scope. Platform is a single-context repository; also read local `CONTEXT.md` and
relevant `docs/adr/` entries when they exist. Their absence is not a setup failure:
`domain-modeling` creates them lazily when durable terminology or a hard-to-reverse trade-off is
actually resolved.

Shared product and cross-repository decisions arrive through a linked Workspace issue. Record each
Platform-specific consequence once:

- product scope in `docs/product/platform-mvp-brief.md`;
- an implementation contract in the technical specification;
- a hard-to-reverse technical trade-off in an application ADR.

Keep build, test, deploy and agent runtime dependent only on files in this repository.
