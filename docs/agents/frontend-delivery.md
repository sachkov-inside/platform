# Frontend delivery

Use one production frontend in `apps/web`. Storybook is its executable UI review surface, not a
second application or data path.

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

   ```ts
   /** Temporary semantic UI for #67; replace through #37 after Storybook acceptance. */
   ```

4. Develop the missing visual module in Storybook through the same presentation interface. Once
   accepted, keep its implementation in a normal feature or shared UI module, let both Storybook
   and production import it, connect the production adapter, and delete the temporary
   implementation and marker in the integration ticket.

Prefer feature ownership. Promote a module to `src/shared/ui` only when more than one real surface
needs the same responsibility and the shared interface is smaller than the duplicated behavior.

## Completion rules

- A functional ticket may merge with temporary semantic UI when the real end-to-end behavior and
  tests pass; final visual acceptance is not a dependency for proving the feature path.
- The owning Specification cannot be `Done` while a linked Storybook/integration ticket or a
  temporary UI marker remains open.
- Production imports no `.storybook`, `src/workshop`, stories, or fixture modules. Enforce this
  through import checks and the production build.
- Storybook fixtures describe representative presentation states only. They never reproduce
  application rules or become a production fallback.

Current examples: Material Reader uses functional ticket #67 followed by integration ticket #37;
Library uses its functional delivery after #28 followed by #39; Authoring/Preview uses its
functional delivery followed by #38.
