# Course package v2 and format c Tasks

Owning task: [#1194](https://github.com/sachkov-inside/platform/issues/1194).
Delivery: [PR #1222](https://github.com/sachkov-inside/platform/pull/1222).
Content source contract: `3deeba8d6cfe48e40184cde6bfd34e6b65802ce2`.

The check uses a synthetic package and temporary source namespace, not real course chapters.
It imports one Material and four Tasks: a leading Task, two after the same Material, and a closed
Task. The page title differs from the YAML title; the page links to a Material and another Task.
The Material links back to the first Task. The package declares only `task-c-v2`.

## Interface evidence

The page reuses the accepted Product Task surface and the Reader document renderer. Storybook and
production import the same modules. The local advice uses native `details`/`summary`; acceptable
agent evidence does not enter the format c reader response.

- [Storybook, desktop width 1440](task-c-storybook-desktop.png).
- [Storybook, mobile width 390](task-c-storybook-mobile.png).

Desktop capture expands the accepted shell's scroll container to include the complete page.
Browser verification opened and closed advice with Enter, loaded the diagram, and found no mobile
horizontal overflow. Independent visual review checked both complete screenshots. It found no
serious visible defects. This is reuse under `docs/agents/frontend-delivery.md`, rule 1.

- [Live imported Task, desktop Chromium](task-c-live-desktop-chromium.png).
- [Live imported Task, mobile Chromium](task-c-live-mobile-chromium.png).

The isolated full-stack smoke passed with exit 0 on `cadd898e`: six desktop/mobile checks for
#1194 and the existing #947 Task flow. It used a fresh disposable PostgreSQL database, RustFS,
and the real authoring API/importer. Both Task c checks loaded the image, refused the closed asset,
opened and closed advice with Enter, checked links in both directions and the four Task positions,
and found no serious/critical axe violations or horizontal overflow. The final repository check
and CI results are recorded after their completion.

## Verification boundaries

`tools/authoring/package-v2.test.mjs` checks envelope refusal before transport/uploads, original
page preservation, source links, image/file references, explicit preview access choices, migration
conflicts and receipt recovery. Existing authoring package/release tests retain v1 coverage. Backend integration checks use real PostgreSQL and cover
immutable historical submissions, HTTP/MCP projections, access, asset delivery and nested image
presentation. `apps/web/test/fullstack/product-task-c.spec.ts` checks actual API import, protected
assets, keyboard advice, links in both directions, programme order, accessibility and screenshots.

The authoring receipt journal and the package are separate: recovery keeps the exact saved request,
while canonical source bytes remain unchanged. Unknown features are refused before writes/uploads.

## Independent review outcomes

| Finding | Outcome |
|---|---|
| Imported body images lacked Assets dimensions | Fixed through public Materials hydration for Reader and MCP; real-DB regression covers nested images |
| Body links retained an old destination after a slug change | Fixed: import stores both original href and emitted URL aliases against the same source ID |
| One PNG used as an image and an attachment mixed asset kinds | Fixed: image lookup and each backing-body reference retain their own typed receipt |
| Canonical exporter also declares general collapsible callouts for Task advice | Kept as an integration dependency under the explicit brief: #1196 owns that capability; unsupported capabilities cannot be advertised |

The current exporter can declare `collapsible-callouts-v1` for generated Task advice. A package with
that declaration is correctly refused until #1196 supplies the capability. The Task-only advice
path is checked with the synthetic `task-c-v2` package. Real export and transfer belong to Content
#56 after neighboring capabilities are integrated. #1194 does not modify Content or migrate an
existing Material into a Task.

Production deployment and publication are outside this delivery.
