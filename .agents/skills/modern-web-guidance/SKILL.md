---
name: modern-web-guidance
description: Consult the checked-in web guides when choosing an unfamiliar browser API, resolving browser compatibility or fallback requirements, or investigating a web performance technique.
---

# Modern Web Guidance

Use the checked-in `guides/` corpus for the specific API, compatibility question or performance
technique under investigation. Routine component edits follow the existing project patterns.

## Find the relevant guide

From the repository root, search the local corpus with an action or API name:

```sh
rg -n -i '<API or topic>' .agents/skills/modern-web-guidance/guides
```

Read the matching guide and apply the relevant recommendations to the project's framework.
The guides use vanilla HTML, CSS and JS; in React keep the modern feature: generate per-instance
IDs and `anchor-name`s with `useId()`, call `showModal()` or `showPopover()` through refs, and pass
newly shipped attributes (`popover="hint"`, `interestfor`, `commandfor`) as attributes rather than
dropping them.
If no guide answers the question, consult the official browser or framework documentation.
Verify time-sensitive support claims against official compatibility data; the installed guides
are a reference snapshot, not proof of current browser support.

The guide corpus is the `guides/` folder of npm package `modern-web-guidance@1.0.0`
(published 2026-11-10, Apache-2.0); its original skill version is `2026_11_09-5bcc021b`. Lookup uses repository files without downloading or executing a package.
Updating the corpus is a separate dependency change with recorded provenance and review.
Treat package retrieval examples in the guides as guide IDs: find those guides in the local corpus
instead of executing their package download commands.

## Browser support

By default, Baseline Widely available features are safe without fallbacks. For other features,
follow the guide's fallback recommendations unless the owner has specified a custom browser policy.
Apply that policy using browser compatibility data; for Baseline YYYY, the feature's Baseline date
must be no later than YYYY. If work reveals a durable browser support requirement, record the
accepted policy in the owning frontend contract reached through `apps/web/AGENTS.md`.
