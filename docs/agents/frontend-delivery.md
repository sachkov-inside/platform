# Frontend delivery

Storybook is the executable UI review surface of `apps/web`, not a second application or data
path.

For Home, Library, Series or Reader changes, read the current
[product navigation contract](../product/platform-mvp-brief.md#поиск-и-навигация),
[Series composition contract](../specifications/platform-v1.md#series-step-sequences),
[Product chapters contract](../specifications/platform-v1.md#product-chapters),
[Product page contract](../specifications/platform-v1.md#страница-руководства) and
[Web presentation](../specifications/web-presentation.md).
These own the accepted content relationships and presentation; earlier design proofs provide
history, not an alternative product model.

## Review surface

Before frontend implementation or interactive UI review, use Storybook from the task's worktree.
Reuse its owned preview when the source matches. Otherwise start `pnpm storybook` on an available
local port; preserve another session's listener on `6006` or any other port.

Use the owned preview's `platform-storybook` MCP endpoint when the runtime can reach it.
Inspect the catalog with `docs-list`, component documentation with `docs-show`, and
`get-storybook-story-instructions` before editing stories. If the configured endpoint belongs to
another worktree, inspect the local stories and catalog source and review the owned preview through
browser tools. Report that fallback; a port conflict alone does not require a new agent session.
Runtime MCP bindings live in `.mcp.json` or `.codex/config.toml`; change them only when the task needs
a durable integration change. Follow [WORKFLOW.md](../../WORKFLOW.md#completion-requirements) for prototype completion.

## Delivery contract

Every full-stack feature owns a small presentation interface. A server-only production adapter
maps the real application result to that interface; a Storybook fixture adapter supplies the same
states for visual review. Business rules, authorization, transport details, backend DTOs and
production fallback behaviour stay behind the production adapter; fixtures hold representative
presentation states only. `.storybook`, `src/storybook`, stories and fixture modules stay in the
Storybook graph, outside production; the web guardrail and the production build confirm it.

The owning Specification and child issue state in plain language what the user receives and
whether the ticket completes the feature or only enables a later integration; technical delivery
details follow that outcome.

Choose the path from the catalog you inspected:

1. Reuse an accepted production-owned UI module when it already covers the required states. Its
   stories and the production route import the same implementation.
2. Use the **accepted-proof path** only when an existing Storybook proof establishes the core
   composition and main interaction, its presentation interface is stable, and the issue links the
   exact recorded owner visual acceptance. The production issue lists any required operational
   states that the proof did not cover. This **proof acceptance gate** says that the
   development-only design is ready to promote; its evidence and owner decision live in the proof
   issue. A proof stays on its `prototype/*` branch. The same vertical ticket may then move the
   presentation implementation into its owning feature or shared module, connect the real
   production adapter, and make both the production route and stories import that module's
   client-safe public interface.

   The ticket may add missing loading, empty, access, not-found, pagination, or error states to the
   production-owned module when they preserve the accepted core composition and interface. Add
   stories for those states and accept them through the production visual gate below. If a missing
   state reopens the core information architecture or visual direction, use the default path in
   step 3 until a new proof is accepted.

   Before handoff, pass a separate **production visual gate**: capture responsive and accessibility
   evidence for the exact production-owned implementation in both Storybook and the live route,
   keep that evidence in the production ticket or linked pull request, resolve every owner
   annotation, and record a new owner visual GO. The earlier proof acceptance is a prerequisite;
   it does not approve the promoted implementation. Production visual GO is not merge GO; the merge
   follows `WORKFLOW.md`. When every accepted-proof condition passes, the one ticket closes the
   functional path and visual integration without temporary UI, a temporary marker, or a second
   integration ticket.
3. Otherwise, when a required UI module or state is missing, unaccepted, or still changing,
   deliver the real functional path with the smallest accessible, feature-local semantic
   implementation behind the presentation interface. It may use accepted primitives, but it does
   not create a speculative reusable visual system or introduce a fake client/data path. This
   functional ticket may merge with temporary semantic UI when the real end-to-end behavior and
   tests pass; final visual acceptance is not a dependency for proving the feature path.
4. Before the functional ticket merges, create or link a native child integration ticket under the
   owning Specification. It names the missing Storybook proof, is blocked by the functional ticket
   and relevant UI-foundation gate, and replaces the temporary implementation after owner visual
   acceptance. Put exactly one marker, at the temporary module's interface, linking both issues.

   Replace the placeholders below with the linked issue numbers:

   ```ts
   /**
    * Temporary semantic UI for #FUNCTIONAL_ISSUE.
    * Replace through #INTEGRATION_ISSUE after Storybook acceptance.
    */
   ```

5. Develop the missing visual module in Storybook through the same presentation interface. Once
   accepted, keep its implementation in a normal feature or shared UI module, let both Storybook
   and production import it, connect the production adapter, and delete the temporary
   implementation and marker in the integration ticket. The owning Specification becomes `Done`
   only after every linked Storybook/integration ticket is closed and every temporary UI marker is
   removed.

## Production foundation imports

The accepted semantic color, typography, radius, elevation and motion tokens and Tailwind theme
live in `apps/web/app/globals.css`. Production and Storybook both import that file; a feature
stylesheet uses those tokens and keeps no copy of their values. The accepted responsive shell is
exported by `@/widgets/application-shell`, while `@/_app` is the production adapter that supplies
App Router path and account state. Public routes use that shell. Authoring routes use the
dedicated authoring shell from `@/widgets/authoring-shell`, accepted in #94: it reuses the same
tokens, replaces the public navigation instead of nesting beside it, and always exposes explicit
routes back to the public Library and site. Keep one token system and one navigation system;
another shell variant needs a new owner decision.

## Catalog stays in sync

The Storybook catalog on `main` shows the product as it is: every production route has a page
story, and every shared module that a page uses has a component story. `src/storybook` holds story
support (the route environments, fetch mocks and fixtures) and the stories of modules that live
outside `apps/web`, such as the Telegram sign-in page of the identity service.

- A pull request that adds or changes a surface updates its stories in the same pull request: a
  new route gets a page story, a new state gets a story, and a removed surface or state takes its
  stories and fixtures with it.
- A route with no page story is listed with its reason on the catalog page `Foundations/Overview`
  (`apps/web/src/storybook/overview.mdx`); the same pull request updates that list.

## Interface evidence

Issue evidence follows [Snapshots as issue evidence](../runbooks/local-verification.md#snapshots-as-issue-evidence).
Two recurring traps affect what a snapshot shows:

- From the `lg` breakpoint the application shell scrolls `[data-application-content]`, and the
  authoring shell scrolls `#authoring-content` from `md`, so a Playwright `fullPage` capture above
  those widths stops at one screen. Capture a whole page with `screenshotWholePage(page, options)`
  from [`apps/web/test/support/whole-page-screenshot.mjs`](../../apps/web/test/support/whole-page-screenshot.mjs)
  in place of `page.screenshot({ fullPage: true })`; its JSDoc explains the viewport stretch,
  retries and budgets. Look at the image before attaching it.
- A single component state needs no live stack: build Storybook with `pnpm build:storybook`, serve
  `apps/web/storybook-static`, and capture
  `iframe.html?id=<kebab-title>--<kebab-export>&viewMode=story` at 390 and 1440 wide. Put the
  capture script inside `apps/web` and import `chromium` from `@playwright/test`, which is the
  installed package. Assert `scrollWidth === clientWidth` before capturing to prove there is no
  horizontal overflow. Serve the build from a small `node:http` server inside that script:
  `python3 -m http.server` drops the parallel module requests and stories fail at random with
  "Failed to fetch dynamically imported module".
