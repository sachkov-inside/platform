# Frontend delivery

Storybook is the workshop of `apps/web`: the executable UI review surface, not a second
application or data path. [Human participation](human-review.md#evidence) owns what proves the
look a user gets.

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
Reuse its owned preview when the source matches. Otherwise start `pnpm storybook` on a free local
port; keep another session's listener on `6006` or any other port.

Use the owned preview's `platform-storybook` MCP endpoint when the runtime can reach it: read
`get-storybook-story-instructions` before editing stories. If the endpoint belongs to another
worktree, read the local stories and review the owned preview in a browser under the
[browser rule](../../AGENTS.md#process); report that fallback.

Design critique, audit or polish of a UI uses `impeccable`, which reads `apps/web/PRODUCT.md` and
`apps/web/DESIGN.md`. A new visual direction still needs the owner's choice from a
prototype under the delivery contract below.

## Prototypes

A prototype stays outside production imports and uses fixtures or in-memory state for mutations.
UI variants use the existing Storybook foundation, in place of the `prototype` skill's `UI.md`
sub-shapes A and B on application routes; logic prototypes follow the skill. Open the variants in a
browser, check the relevant viewport sizes and the interaction that answers the design question, and
share the URL with its limits as soon as it works. Full checks, finish review, an Issue, a PR and
`ship` are not needed for the preview. Record the proof and the owner's decision on a `prototype/*`
branch before promotion or a handoff to another session. A selected variant records a direction;
implementation starts when the owner assigns it.

## Delivery contract

Every full-stack feature owns a small presentation interface. A server-only production adapter
maps the real application result to that interface; a Storybook fixture adapter supplies the same
states for visual review. Business rules, authorization, transport details, backend DTOs and
production fallback behaviour stay behind the production adapter; fixtures hold representative
presentation states only. `.storybook`, `src/storybook`, stories and fixture modules stay in the
Storybook graph, outside production; the web guardrail and the production build confirm it.

The owning Specification and child issue state in plain language what the user receives;
technical delivery details follow that outcome.

One ticket delivers the functional path and its look in a production-owned UI module that the
route and its stories both import. Choose the source of the look from the catalog you inspected:

1. Reuse a production-owned UI module when it already covers the required states.
2. For a new visual direction, the owner chooses it from a [prototype](#prototypes). The
   production issue links that recorded choice and lists the operational states the prototype did
   not cover (loading, empty, access, not-found, pagination, error). The ticket moves the
   presentation into its owning feature or shared module and connects the production adapter; the
   prototype stays on its `prototype/*` branch. A missing state that reopens the core information
   architecture or visual direction needs a new prototype and choice.
3. Otherwise build the module behind the presentation interface from the accepted primitives and
   tokens of `apps/web/DESIGN.md`.

The look is accepted once, in the pull request: [verification](human-review.md#verification)
shows it in the running application, and [owner attention](owner-attention.md) decides whether the
owner is called.

Markers `Temporary semantic UI for #…` and their integration tickets come from the earlier
contract (#2229). Each closes under its own ticket; new work adds none.

## Production foundation

Keep one token system and one navigation system. Production and Storybook import the same tokens
from `apps/web/app/globals.css`; a feature stylesheet keeps no copy of their values. Public routes use
`@/widgets/application-shell`; authoring routes use `@/widgets/authoring-shell`, which follows owner
decisions 2, 8 and 13 of the [admin redesign specification](../specifications/authoring-admin-redesign-v1.md)
(#1717): it replaces the public navigation and always links back to the public Library and site.
Another shell variant needs a new owner decision.

## Stories

Storybook holds the stories that do work the running application cannot do cheaply:

- **Component story**: every shared module that a page uses has one. `storybook-catalog.test.ts`
  checks `src/shared/ui`; a helper with nothing to show is listed with its reason in
  `apps/web/src/storybook/catalog.json`.
- **Page story**: for a state that is hard to reach in the running application (an error, loading,
  denied access, a payment outcome, long text), or to test the page's behaviour with a `play`
  scenario. A route needs no page story otherwise.

A pull request that changes a surface keeps its stories true in the same pull request: a new
hard-to-reach state gets a story, and a removed surface or state takes its stories and fixtures
with it. `src/storybook` holds story support (the route environments, fetch mocks and fixtures)
and the stories of modules that live outside `apps/web`, such as the Telegram sign-in page of the
identity service.

## Interface evidence

[Human participation](human-review.md#evidence) owns what counts as evidence and [PR body](pr.md#attachments)
how it reaches the PR; [Snapshots as issue evidence](../runbooks/local-verification.md#snapshots-as-issue-evidence)
owns where a run writes snapshots. Two recurring traps affect what a snapshot shows:

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
