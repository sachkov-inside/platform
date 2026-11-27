# Frontend delivery

Review the interface on the running application with test data. [Human participation](human-review.md#evidence)
owns the evidence needed for a pull request.

For Home, Library, Series or Reader changes, read the current
[product navigation contract](../product/platform-mvp-brief.md#поиск-и-навигация),
[Series composition contract](../specifications/platform-v1.md#series-step-sequences),
[Product chapters contract](../specifications/platform-v1.md#product-chapters),
[Product page contract](../specifications/platform-v1.md#страница-руководства) and
[Web presentation](../specifications/web-presentation.md).
These own the accepted content relationships and presentation; earlier design proofs provide
history, not an alternative product model.

## Review surface

Use [the local verification procedure](../runbooks/local-stand.md#light-instance-per-agent) to
drive one representative user scenario. Read the production route and the existing tests before
editing. Storybook fixtures remain in CI while their unique assertions are moved to the owning
test suites.

Design critique, audit or polish of a UI uses `impeccable`, which reads `apps/web/PRODUCT.md` and
`apps/web/DESIGN.md`. A new visual direction still needs the owner's choice from a
prototype under the delivery contract below.

## Prototypes

A prototype stays outside production imports and uses fixtures or in-memory state for mutations.
UI variants use an isolated application route on a prototype branch. Logic prototypes follow the skill. Open the variants in a
browser, check the relevant viewport sizes and the interaction that answers the design question, and
share the URL with its limits as soon as it works. Full checks, finish review, an Issue, a PR and
`ship` are not needed for the preview. Record the proof and the owner's decision on a `prototype/*`
branch before promotion or a handoff to another session. A selected variant records a direction;
implementation starts when the owner assigns it.

## Delivery contract

Every full-stack feature owns a small presentation interface. A server-only production adapter
maps the real application result to that interface. Synthetic data and test backend responses supply the review states. Business rules, authorization, transport details, backend DTOs and
production fallback behaviour stay behind the production adapter; fixtures hold representative
presentation states only. `.storybook`, `src/storybook`, stories and fixture modules stay in the
Storybook graph, outside production; the web guardrail and the production build confirm it.

The owning Specification and child issue state in plain language what the user receives;
technical delivery details follow that outcome.

One ticket delivers the functional path and its look through the production route:

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

Markers `Temporary semantic UI for #…` and their integration tickets are leftovers of the path
that #2229 retired. New work adds none; a remaining marker is removed under its own ticket.

## Production foundation

Keep one token system and one navigation system. Production and Storybook import the same tokens
from `apps/web/app/globals.css`; a feature stylesheet keeps no copy of their values. Public routes use
`@/widgets/application-shell`; authoring routes use `@/widgets/authoring-shell`, which follows owner
decisions 2, 8 and 13 of the [admin redesign specification](../specifications/authoring-admin-redesign-v1.md)
(#1717): it replaces the public navigation and always links back to the public Library and site.
Another shell variant needs a new owner decision.

## Existing UI fixtures

New components and pages use the [owning test seam](testing.md#choosing-the-kind) for the behavior
they introduce. When removing a Storybook fixture, record which remaining check proves each
distinct assertion. Move missing assertions to navigation, full-stack, browser-engine or module
tests according to the actual behavior. Remove purely demonstrative variants when the application
can show them with test data.

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
