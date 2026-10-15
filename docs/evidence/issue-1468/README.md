# Design laboratory #1468

Development-only proof on `prototype/1468-design-lab`. The owner has not accepted a direction.
Keep #1468 open until comparison review and the owner's decisions are recorded.

## Start and stop

From this prototype worktree, install the pinned dependencies with `pnpm install --frozen-lockfile`.
Run `pnpm design:lab`. The launcher selects a free IPv4 loopback port and prints the overview URL and owner PID.
Use `DESIGN_LAB_PORT=62368 pnpm design:lab` to request the original review port.
A busy requested port fails without replacing its listener.
Stop with Ctrl+C or `kill -TERM <printed-owner-pid>`.
The repository's `spawnOwned`/`stopOwned` supervisor stops the complete owned process tree.

The active PID, port, cwd, source commit and browser session are recorded in issue #1468.
Preserve that review server until the owner finishes review or requests shutdown.
Do not start the full application or Compose for these fixture comparisons.

## Entry points

The isolated `.storybook-lab` configuration discovers only the laboratory stories.
The ordinary catalog excludes their `*.prototype.stories.tsx` filename.
No Storybook MCP tool was available in this runtime; discovery used the actual `/index.json` and browser.

| Story ID | Scope |
| --- | --- |
| `prototypes-design-lab--overview` | Overview, scenario navigation, variant selection and in-memory verdicts |
| `prototypes-design-lab--workspace` | Current structure, Product sections, Product overview |
| `prototypes-design-lab--next-action` | Author preparation and learner onboarding |
| `prototypes-design-lab--creation-form` | Empty, populated, pending, occupied address, invalid field, unavailable server, success |
| `prototypes-design-lab--upload` | Text/indicator and Sileo; waiting, success, error and retry |

Open `iframe.html?id=<story-id>&viewMode=story` on the printed origin.
`scenario=workspace|next|form|upload&variant=0|1|2` links directly to a comparison.
Only Workspace has variant 2. Reset restores the active scenario's demonstration state.
Variant changes preserve the scenario's in-memory data.
Changing scenarios, resetting or refreshing discards that scenario's edits.
Verdicts survive navigation but not refresh; record an owner decision in the issue before handoff.

## Starting sources and coordination — 2026-10-15

- Base: `d0ff7fde53ee70770abdedafabd29cf6e36caf99`, current `origin/main` at execution start.
- #1448 remains the owner of authoring information architecture. Its interview and final choices remain pending.
- PR #1449 is closed. Its preserved head is `ab05b08ee7c4e8f2591723b35e7858e4e8bebc1b`.
- #1442 and #1443 are closed. Implementation PR #1494 merged as the base above.
  The current Product contract removes completed Onboarding on desktop and mobile.
- Research #1455 was delivered by PR #1459 at `776807c26160c8f63bb7375bd505f417a55133a2`.

Baselines are explicitly labelled, local reconstructions of relevant structures, not embedded production routes.
Workspace follows `content-collections-page.client.tsx`, `series-editor-page.client.tsx` and authoring navigation.
The form follows the existing name/address/summary fields and collection mutation messages.
Learner navigation follows #1449's three-step composition and the current #1443 completion requirement.
Upload reproduces the text/indicator pattern, with the same simulated operation as Sileo.
Fixtures use the same Product, material and file facts across each comparison's variants.
The laboratory imports the existing Button primitive and token foundation; no production module imports the laboratory.

## Reference provenance

No vendor component source was copied. Composition and field relationships were implemented locally.
All reference pages below were inspected on 2026-10-15; their live documentation is not a pinned library version.
The research report contains the original source inventory and licence evidence.

| Experiment | Reference | Use and dependency cost |
| --- | --- | --- |
| Product sections | [blocks.so Sidebar](https://blocks.so/sidebar), [Astryx settings-sidebar](https://github.com/facebook/astryx/blob/main/packages/cli/assets/templates/pages/settings-sidebar/page.tsx) | Product context and local sections; no new runtime dependency |
| Next action | [blocks.so Onboarding](https://blocks.so/onboarding), [Astryx Stepper](https://github.com/facebook/astryx/blob/main/packages/core/src/Stepper/Stepper.doc.mjs) | Ordered completed/current/future actions; no Astryx or Base UI code installed |
| Form | [blocks.so Form layout](https://blocks.so/form-layout), [HeroUI TextField](https://heroui.com/en/docs/react/components/text-field), [Appica forms](https://appica.dev/ui/docs/react/forms) | Labels, help, field errors and focus; no new form library |
| Upload | [Sileo docs](https://sileo.aaryan.design/docs) | Actual Sileo 0.1.6, MIT, web devDependency only |

Existing foundation: Manrope and JetBrains Mono 5.3.0 (OFL-1.1), Lucide React 1.50.0 (ISC),
Radix UI 1.6.7 (MIT), React/React DOM 19.3.0 (MIT), Storybook 10.6.1 (MIT).
The existing shadcn-derived Button is reused without a component-system migration.
Sileo adds five lockfile packages: Sileo 0.1.6, Motion and Framer Motion 12.43.0,
Motion DOM 12.43.0, Motion Utils 12.39.0 (MIT).
Its published unpacked package size is 122,782 bytes; this is not browser transfer size.
The isolated build's combined story JS chunk is approximately 247 kB (77 kB gzip).
That chunk includes all four comparisons and Sileo/Motion; it is not the incremental Sileo cost.
Sileo's generated CSS chunk is 8,557 bytes (2,130 bytes using Python gzip).
No new fonts, icon family, paid references or generated imagery were added.

## Checked scope — 2026-10-15

- Actual `/index.json` exposes all five story IDs.
- Browser: own headed Chromium session `platform-1468` on the owner's Mac.
- Captures cover Overview and every variant at 390 and 1440 px; no document horizontal overflow.
- All three Workspace variants: select Product, open a shared Material, public reading, return to Preview,
  inspect participants/access, return to shared Materials, filter by Product or no Product, preserve selected Product.
- Imported Material has no edit action. The demo also exposes author, read-only and source-owned boundary controls.
- Both next-action variants: link Telegram, request membership, simulate join error, retry, confirm membership,
  start the first lesson, remove completed Onboarding, and omit community onboarding when no community is included.
- Author draft survives section changes. Preview uses the saved local description and does not publish.
- Both form variants: occupied address, explicit pending response, unavailable server, retained values, retry and success.
- Proposed form: keyboard field order, Enter submit, invalid slug, first-error focus and `aria-describedby` links.
  The occupied-address focus defect found during verification was fixed after the pending fieldset becomes enabled.
- Both uploads: waiting, failure, retry, success, and continued field editing.
- Sileo waiting/error does not steal the input's focus. Its 350 px notification fits both checked widths.
  A reserved area prevents it from covering working results or review controls.
- Reduced-motion emulation removes Sileo entirely and retains the persistent polite live result.
- Axe WCAG A/AA checks found zero violations in five sampled proposed states: overview, Workspace A,
  author next action, form error and upload error. This is not exhaustive accessibility certification.
- Form errors have invalid state and described error text. Sileo supplies a polite live region;
  the baseline and reduced-motion fallback use the persistent working-area live region.
- Actual VoiceOver speech was not checked. Announcement timing and verbosity still require a human screen-reader pass.
- Focused lint, Web TypeScript, scripts TypeScript, Web architecture guardrails, formatting and `pnpm docs:check` pass.
- The isolated Storybook build passes. Vite warns about React `use client` directives in its client-only bundle.
- A second launcher instance started on port 49401. SIGTERM to owner PID 86132 removed its Storybook listener and process.
  The review instance on port 62368 remained available.
- Full application suites, production build, CI, payment, Telegram, real uploads and production deployment were not run.
  They are outside this fixture-only preview assignment.

Screenshots in this directory identify scenario, variant and viewport width.
`form-error-*`, `learner-next-*` and `upload-sileo-error-*` show operational states.
`upload-reduced-motion-390.png` shows the static fallback.

## Owner refinement — rounded surfaces, 2026-10-15

The owner rejected the abundance of straight dividers and requested a more rounded, modern design.
The laboratory frame now groups comparisons with rounded surfaces, spacing and the existing soft elevation token.
Proposed variants replace decorative row rules, tab underlines and rectangular navigation regions with rounded tonal groups.
The baseline content retains its separators for comparison. The shared laboratory frame changes around every variant.
Input boundaries and keyboard focus remain visible. This is a styling direction, not acceptance of either information architecture.

`rounded-*` captures supersede the initial screenshots for the proposed styling.
All six captured views at 390/1440 px have no horizontal overflow.
Material opening/return and first-error form focus were checked in the browser.
Focused lint, Web TypeScript, formatting, documentation checks and the isolated Storybook build pass.
No new Axe result is claimed for this refinement; the earlier sampled results describe the initial revision.

## Full-screen application study — 2026-10-15

The owner requested a complete modern design informed by Notion, Linear, GitHub, X, ChatGPT and Claude.
This supersedes treating the request as a radius-only refinement.
The new study is a standalone authoring application inside Storybook, linked from the laboratory overview.
The existing four comparisons remain available. Product architecture and production integration still await owner acceptance.

Open `iframe.html?id=prototypes-inside-concept--app&viewMode=story` on the running review server.
Additional direct stories are `prototypes-inside-concept--product` and `prototypes-inside-concept--materials`.
The isolated catalog now contains eight stories in total.

| Primary reference, inspected 2026-10-15 | Local interpretation |
| --- | --- |
| [Linear redesign](https://linear.app/now/how-we-redesigned-the-linear-ui), [Linear Mobile](https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile) | Restrained navigation density, contextual actions, consistent Product context; mobile and desktop reference images were inspected |
| [Notion mobile workspaces](https://www.notion.com/en-us/help/workspaces-on-mobile) | Persistent bottom navigation and continuity with desktop workspace sections |
| [GitHub Primer navigation](https://primer.style/product/ui-patterns/navigation/) | Global navigation separated from Product-local sections and parent/detail navigation |
| [ChatGPT content navigation](https://help.openai.com/en/articles/10056348-finding-your-chats-projects-and-files-in-chatgpt) | Search over work content, separate from the primary content canvas |
| [Claude projects](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects) | Project context kept around the work; this is an interpretation, not a claim of copying Claude's exact UI |
| [X for iOS](https://help.x.com/en/using-x/x-ios-app) | Readable content flow and adjacent actions; this is an interpretation, not a verified specification of X's current navigation geometry |

No vendor component implementation, logo, or screenshot is shipped in the concept.
The existing Inside Button, Radix Dialog/DropdownMenu, Manrope, Lucide, color and radius tokens supply the foundation.
There are no additional dependencies. Prototype-specific typography is exploratory; production DESIGN.md was not replaced.
The covers are byte-identical copies of existing Inside review artwork from #271; their local provenance lives beside the assets.
They do not assign new covers to real Products.

Implemented local screens: Product catalog, Product programme, participants/access context, common Materials, editor,
saved-state Preview, search dialog, creation dialog and a profile page with the reference inventory.
The phone uses persistent bottom navigation; desktop uses one compact workspace sidebar.
Saving, creation and search operate only on in-memory demonstration data. Refresh resets the study.
No payment, Telegram, permission change, publication or real account action occurs.

Verification: catalog, Product, editor, Preview and search captured at 390/1440 px in headed Chromium.
No document horizontal overflow was observed. Product tabs, chapter collapse, material opening/return, edit/save/Preview,
material creation, search empty state, Product creation and empty programme were exercised at both widths.
Search autofocus, Escape and return to the initiating control were verified.
The focus assertion waits for Radix's actual restoration instead of sampling before its scheduled cleanup.
Focused lint, Web TypeScript, Web architecture guardrails, formatting, documentation checks and the isolated Storybook build pass.
The design detector reported type/radius ramp advice: literal radii were moved to existing tokens;
prototype typography remains an explicit study decision. No new screen-reader speech or complete accessibility result is claimed.

`concept-*` screenshots record this new application study; earlier `rounded-*` images record the earlier laboratory refinement.
The visible browser remains on the new application entry. Owner review is pending.

## Pending owner review

| Proposal | Decision | Owning work |
| --- | --- | --- |
| Workspace A: local Product sections | Pending | #1448 |
| Workspace B: Product overview | Pending | #1448 |
| Author's explicit next preparation action | Pending | #1448 / future assigned implementation |
| Learner's explicit unfinished action | Pending | Follow-up to completed #1442–#1443 |
| Grouped form and field feedback | Pending | Implementation issue after owner selection |
| Sileo upload notification | Pending | Bounded experiment; no component migration authorized |

Workspace questions remain open: which entry should be the default; whether shared Materials means all reusable Materials
or only Materials without a Product; which participant/access actions belong locally; and where Topics should remain.
Neither variant deletes Topic data or changes permissions.
Reject Sileo if human review finds hidden results, interrupted focus or decoration without task benefit.
The reserved notification area and static reduced-motion fallback are experiment adaptations, not production decisions.
