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

Before implementing a surface, inspect the Storybook catalog and its MCP documentation:

1. Reuse an accepted production-owned UI module when it already covers the required states. Its
   stories and the production route import the same implementation.
2. When a required UI module or state is missing, deliver the real functional path with the
   smallest accessible, feature-local semantic implementation behind the presentation interface.
   It may use accepted primitives, but it does not create a speculative reusable visual system,
   import `src/workshop` or Storybook fixtures, or introduce a fake client/data path.
3. Before the functional ticket merges, create or link a native child integration ticket under the
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

4. Develop the missing visual module in Storybook through the same presentation interface. Once
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
path and account state.

For #37–#39, move an accepted surface implementation out of `src/workshop` into its owning FSD
slice before connecting real data. Its story and production route then import the same client-safe
public interface. Never import `.storybook`, `src/workshop`, stories or fixture adapters from a
production route, and do not create a parallel token or navigation system.

## Completion rules

- A functional ticket may merge with temporary semantic UI when the real end-to-end behavior and
  tests pass; final visual acceptance is not a dependency for proving the feature path.
- The owning Specification becomes `Done` only after every linked Storybook/integration ticket is
  closed and every temporary UI marker is removed.
- Import checks and the production build confirm that `.storybook`, `src/workshop`, stories, and
  fixture modules stay outside the production dependency graph.
- Storybook fixtures contain representative presentation states only; application rules and
  production fallback behavior remain behind production adapters.
