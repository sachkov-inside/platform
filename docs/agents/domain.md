# Domain docs

Platform is a single-context repository. Read local `CONTEXT.md` and relevant `docs/adr/` entries
when they exist. Their absence is not a setup failure: `domain-modeling` creates them lazily when
durable terminology or a hard-to-reverse trade-off is actually resolved.

Until versioned product context is intentionally added here, use the Platform issue as the local
implementation contract. Do not read a machine-local Workspace path. Product and cross-repository
decisions are resolved in Workspace and transferred here as an explicit versioned artifact or
issue contract, never as a runtime dependency.
