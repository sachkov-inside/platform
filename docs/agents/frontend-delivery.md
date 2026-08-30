# Frontend delivery

Use one production frontend in `apps/web`. Storybook is its executable UI review surface, not a
second application or data path.

## Review surface

Use Agentation as the owner-feedback overlay during interactive browser and Storybook review. Keep
it enabled while the owner reviews the UI; automated tests disable it only when the overlay would
interfere with assertions. Review is complete when every annotation is resolved or represented by
a linked follow-up issue.

## Delivery contract

Every full-stack feature owns a small presentation interface. A server-only production adapter
maps the real application result to that interface; a Storybook fixture adapter supplies the same
states for visual review. Business rules, authorization, transport details, and backend DTOs stay
behind the production adapter.

The owning Specification and child issue state in plain language what the user receives and
whether the ticket completes the feature or only enables a later integration; technical delivery
details follow that outcome.

Before implementing a surface, inspect the Storybook catalog and its rendered Docs pages:

1. Reuse an accepted production-owned UI module when it already covers the required states. Its
   stories and the production route import the same implementation.
2. Use the **accepted-proof path** only when an existing Storybook proof establishes the core
   composition and main interaction, its presentation interface is stable, and the issue links the
   exact recorded owner visual acceptance. The production issue lists any required operational
   states that the proof did not cover. This **proof acceptance gate** says that the
   development-only design is ready to promote; its evidence and owner decision live in the proof
   issue. The same vertical ticket may then move the presentation
   implementation into a normal feature or shared module, connect the real production adapter,
   and make both the production route and stories import that module. Storybook fixtures stay in
   the Storybook graph; production does not import `src/workshop`, stories, or fixtures.

   The ticket may add missing loading, empty, access, not-found, pagination, or error states to the
   production-owned module when they preserve the accepted core composition and interface. Add
   stories for those states and accept them through the production visual gate below. If a missing
   state reopens the core information architecture or visual direction, use the default path in
   step 3 until a new proof is accepted.

   Before handoff, pass a separate **production visual gate**: capture responsive and accessibility
   evidence for the exact production-owned implementation in both Storybook and the live route,
   keep that evidence in the production ticket or linked pull request, resolve every owner
   annotation, and record a new owner visual GO. The earlier proof acceptance is a prerequisite;
   it does not approve the promoted implementation. Production visual GO is not merge GO: the pull
   request still requires the separate owner merge approval defined in `WORKFLOW.md`. When every
   accepted-proof condition passes, the one ticket closes the functional path and visual
   integration without temporary UI, a temporary marker, or a second integration ticket.
3. Otherwise, when a required UI module or state is missing, unaccepted, or still changing,
   deliver the real functional path with the smallest accessible, feature-local semantic
   implementation behind the presentation interface. It may use accepted primitives, but it does
   not create a speculative reusable visual system, import `src/workshop` or Storybook fixtures,
   or introduce a fake client/data path.
4. Before the functional ticket merges, create or link a native child integration ticket under the
   owning Specification. It names the missing Storybook proof, is blocked by the functional ticket
   and relevant UI-foundation gate, and replaces the temporary implementation after owner visual
   acceptance. Put one marker at the temporary module's interface, linking both issues; do not
   scatter TODO comments through its implementation.

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
   implementation and marker in the integration ticket.

Prefer feature ownership. Promote a module to `src/shared/ui` only when more than one real surface
needs the same responsibility and the shared interface is smaller than the duplicated behavior.

## Production foundation imports

The accepted semantic color, typography, radius, elevation and motion tokens and Tailwind theme
live in `apps/web/app/globals.css`. Production and Storybook both import that file; do not copy
token values into a feature stylesheet. The accepted responsive shell is exported by
`@/widgets/application-shell`, while `@/_app` is the production adapter that supplies App Router
path and account state. Public routes use that shell. Authoring routes use the dedicated,
feature-owned Material Authoring shell accepted in #94: it reuses the same tokens, replaces the
public navigation instead of nesting beside it, and always exposes explicit routes back to the
public Library and site. Do not introduce another shell variant without a new owner decision.

For production surface tickets such as #89, #90 and #94, move an accepted surface implementation
out of `src/workshop` into its owning FSD slice before connecting real data. Its story and
production route then import the same client-safe public interface. Never import `.storybook`,
`src/workshop`, stories or fixture adapters from a production route, and do not create a parallel
token or navigation system.

## Completion rules

- A functional ticket may merge with temporary semantic UI when the real end-to-end behavior and
  tests pass; final visual acceptance is not a dependency for proving the feature path.
- The owning Specification becomes `Done` only after every linked Storybook/integration ticket is
  closed and every temporary UI marker is removed.
- Import checks and the production build confirm that `.storybook`, `src/workshop`, stories, and
  fixture modules stay outside the production dependency graph.
- `pnpm test:storybook` and `pnpm build:storybook` confirm that stories remain executable and the
  review catalog can be built without a separate Storybook automation protocol.
- Storybook fixtures contain representative presentation states only; application rules and
  production fallback behavior remain behind production adapters.
