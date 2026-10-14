# Production React effects audit

Date: 2026-10-14. Source HEAD: `2b650e946af93d409a8d1518a2eda12b65247fed`.
Scope: all production `useEffect` and `useLayoutEffect` callsites under `apps/web/app` and `apps/web/src`.
No application code was changed. This is a static audit; no browser timing, network trace or reproduction was performed.

## Result

The inventory contains **87 callsites across 58 files: 81 useEffect and 6 useLayoutEffect**.
There are no direct effect callsites in `apps/web/app`; route error components delegate reporting to a feature hook.
Three source-confirmed improvement opportunities are recorded below. Two are small cleanup opportunities, not demonstrated latency regressions.
Most effects have a real external owner: DOM, timers, player, editor, query cache, session storage or browser events.
No broad pattern of filtering or mapping props into effect-managed state was found.

The scan excluded stories, tests, generated code, fixtures and `src/storybook`. Imports and effect calls were cross-checked with `rg`.
Every production callsite appears in the coverage table. Caller and cache ownership were inspected for suspected problems.

## Confirmed findings

### EF-1 — Video deletion polling permits overlapping reconciliation requests

Priority: medium. Confidence: high for permitted concurrency; frequency and production impact require measurement.

Sources: `apps/web/src/features/material-video/ui/material-video-authoring.client.tsx:188`, `:158`, `:120`; `apps/web/src/features/material-video/api/video-authoring.browser.ts:76`.

The deletion effect launches `reconcile(videoId)` every 5,000 ms using `setInterval`.
`reconcile` awaits a `useMutation().mutateAsync` operation without an in-flight guard or per-request generation.
The adapter performs a POST; it has no client cache or deduplication.
Cleanup stops later ticks, but does not invalidate already-started requests for the effect's previous target.
The `operation` generation protects against explicit upload/remove operations and component disconnection, not concurrent polling responses.

If reconciliation takes longer than five seconds, the next tick starts another POST before the previous POST finishes.
Requests for one video can resolve out of order and replace `deletionVideo` with an older response.
This can add server work and restart polling after a terminal outcome. This consequence is conditional, not a measured production occurrence.
TanStack documents that mutations run in parallel by default; mutation usage does not provide query deduplication.
[Primary source: TanStack mutation scopes](https://tanstack.com/query/latest/docs/framework/react/guides/mutations#mutation-scopes).

Proposed direction: keep external synchronization, but allow one reconciliation per video at a time.
Schedule the next poll after the previous result, and ignore stale target/generation results.
Do not replace this effect with a click-only handler; deletion completion must arrive automatically.

Verification criterion: hold one reconciliation response beyond five seconds with a controlled promise.
Assert at most one request for that video remains in flight. Resolve terminal state, then resolve an older request if one was already started.
The UI must retain terminal state and stop polling. Repeat after target replacement and Activity hide/reveal.

### EF-2 — BillingContactPanel retains a callback effect with no production consumer

Priority: low. Confidence: high.

Sources: `apps/web/src/features/billing-contact/ui/billing-contact-panel.client.tsx:24`, `:49`; `apps/web/src/_pages/account-purchases/ui/account-purchases-page.client.tsx:39`.

The effect forwards query data to optional `onStateChange` after commit.
A repository search found one production `BillingContactPanel` consumer. It renders `<BillingContactPanel />` without that callback.
Other contact consumers call `useBillingContact` directly; they do not receive state through this panel.
Therefore the effect currently performs no parent update in production.

Consequence: dead callback API and effect scheduling add maintenance cost. There is no evidence of an extra production render from this effect.
Proposed direction: remove the unused callback contract and effect after checking intended public consumers.
If a real consumer is introduced, let that consumer read the existing feature hook rather than mirror child state upward.
Verification criterion: production and Storybook consumers compile; account purchases and contact verification remain unchanged.

### EF-3 — Material authoring duplicates an already synchronous draft-ref update

Priority: low. Confidence: high for current setters.

Sources: `apps/web/src/_pages/material-authoring/ui/material-authoring-page.client.tsx:58`, `:64`, `:141`, `:211`.

The layout effect copies `draft` into `draftRef` after every draft commit.
The three `setDraft` callsites already assign the same new value to `draftRef.current` in the event/save path.
The initial ref is initialized from the initial draft. No separate setter path was found.
The effect therefore repeats an assignment whose responsibility already belongs to those update paths.

Consequence: unnecessary pre-paint lifecycle work and duplicate ownership of one synchronization invariant.
This is a small cleanup; no measurable latency benefit is claimed.
Proposed direction: retain one draft update function that updates state and ref together, then remove the duplicate layout effect.
Do not remove the ref itself: stable editor/save callbacks intentionally need the latest draft.
Verification criterion: edit while a save is pending, then flush before preview/back navigation.
Later edits, resulting content version and video selection must remain current; all draft setters must use the single update path.

## Candidates requiring measurement or broader design work

### EC-1 — Repeated fact-channel subscriptions scale with consumers

Sources: `apps/web/src/features/billing-subscription/model/use-current-billing.client.ts:34`, `apps/web/src/features/billing-contact/model/use-billing-contact.client.ts:25`, `apps/web/src/shared/api/fact-announcement.ts:52`.
Each read hook instance opens a channel subscription. Billing is read by the public frame, cabinet and panels.
This duplicates listeners/channels, but not necessarily network requests: both billing/contact reset functions use `cancelRefetch: false`.
Sources: `apps/web/src/features/billing-subscription/model/current-billing.ts:75`; `apps/web/src/features/billing-contact/model/billing-contact-query.ts:54`.
Do not report a duplicate fetch merely from counting hooks.
Measure active channels and callbacks during cabinet/product flows. Consolidate only if their cost is material.
A future consolidation must retain same-document fallback, cross-tab updates, enabled/disabled surfaces and Activity reconnection.

### EC-2 — Author feedback reconciliation republishes layout-owned React state

Source: `apps/web/src/_pages/task-submissions/ui/task-submissions-runtime.client.tsx:76`.
The effect commits accepted server feedback into a layout-owned draft record.
This is React-to-React synchronization, but it has a durable purpose: remember accepted revisions across navigation and older server responses.
The returned draft is already derived during render with `reconcileFeedbackDraft`; users do not first see an unreconciled draft.
The setter skips unchanged records, but accepting a new revision does update the provider after commit.
Measure commit count and queue/detail render cost. Consider moving revision ingestion to the data owner if this proves expensive.
Verification must retain unsaved text, accepted revision monotonicity, queue/detail consistency and navigation retention.
A keyed reset alone would lose required editing-session state.

### EC-3 — Responsive image composition is discovered after hydration

Source: `apps/web/src/features/material-assets/ui/material-responsive-image.client.tsx:40`, `:81`, `:113`.
With `imageVariants`, the initial selection is undefined, so no image element renders until DOM width/theme detection runs.
This avoids loading the wrong composition and uses CSS ratios to reserve geometry.
It may delay request discovery for an above-fold variant image; no duplicate initial download was found.
Measure image discovery, LCP and downloaded bytes on representative dark/light and narrow/wide readers.
Consider declarative picture/container-aware delivery only if it can preserve the existing theme and protected delivery contract.
Accept a change only if request discovery improves without wrong-variant requests, layout shifts or loss of viewer behavior.

### EC-4 — Home-feed prefetch runs on each non-home route change

Source: `apps/web/src/_app/ui/use-mobile-navigation.client.ts:143`.
After 250 ms on a visible non-home route, the effect asks the existing QueryClient for `homeFeedQueryOptions`.
This is intentional cache warming, not a second read owner. Timer cleanup and visibility guards are present.
Measure request count, cache hits and transferred bytes across realistic non-home journeys, together with home-return latency.
Keep it if the navigation benefit outweighs unused traffic; otherwise narrow activation to an explicit return intent or cache need.
Do not call it redundant without checking query freshness and infinite-query behavior.

## Good patterns and rejected false positives

- `useLiveSearchValue` uses a cleaned timer to express a deliberate 250 ms debounce; it is not redundant derived state.
- `CheckoutFlow:309` automatically creates a quote for one-time purchases, including direct entry and changed offer/promo conditions.
  Its selection identity includes option ID, revision, payment mode and promo code (`:109`). A click handler alone would miss entry.
  Old responses are guarded by selection identity. Suppressed exhaustive-deps alone does not establish a bug here.
- `PurchaseReturn:217` reacts to externally confirmed purchase state, with ref and remembered-purchase guards before refresh/announcement.
- `MaterialPrimaryVideo:98` owns external player/session mounting and destruction, with late-resolution checks and hash listener cleanup.
  SDK loading is dynamic. Player progress and chapters are external events, not props-derived state.
- `MaterialReadingScope:110` deliberately publishes to an external store before paint. It preserves streamed boundary hydration (#747).
  Its equality check skips unchanged snapshots. Replacing it with ordinary changing context could reintroduce the documented hydration issue.
- DOM dialog opening, focus restoration after viewer removal, editor editability, resize/intersection observers and scroll restoration synchronize external objects.
- Reading, billing, bookmark and notification effects subscribe to feature-owned announcements and return unsubscribe functions.
- Autosave preserves failed snapshots and serializes writes. Its effect owns a debounce timer, not a render-only calculation.
- Hidden-page marker effects remove document-wide state when Activity disconnects them; deleting them would break navigation retention behavior.

React's criterion is synchronization with an external system, not whether an effect calls a setter.
For values derived solely from props/state, React recommends render-time calculation or state adjustment.
[React guidance](https://react.dev/learn/you-might-not-need-an-effect) and [useEffect API](https://react.dev/reference/react/useEffect).
The audit applies `rerender-derived-state-no-effect`, `rerender-move-effect-to-event`, `rerender-dependencies` and `client-event-listeners` as review prompts.
Repository contracts take precedence over automatic blanket removal.

## Complete callsite coverage

Each line below refers to an effect callsite, not its import. `L` marks useLayoutEffect; unmarked lines useEffect.
“Retain” means the callsite has a concrete synchronization/lifetime purpose under the inspected contracts, not that runtime performance is proven.

| Source | Calls | Classification and purpose |
| --- | --- | --- |
| `apps/web/src/_app/ui/auth-status-control.client.tsx` | 44 | Retain: auth status network refresh on mount/focus/BFCache; active and latest-generation guards. |
| `apps/web/src/_app/ui/mobile-navigation-location.client.tsx` | 14L | Retain: publish committed router location to scroll/history owner before paint. |
| `apps/web/src/_app/ui/navigation-timing.client.tsx` | 39 | Retain: browser performance measurement. |
| `apps/web/src/_app/ui/use-access-change-refresh.client.ts` | 22, 30, 37 | Retain: billing/reading subscriptions and account-change router refresh. |
| `apps/web/src/_app/ui/use-mobile-navigation.client.ts` | 75, 124L, 143, 160L | Retain: navigation/scroll listeners, account cache reset, scroll restoration; prefetch EC-4. |
| `apps/web/src/_pages/account/ui/profile-avatar-editor.client.tsx` | 113 | Retain: release image object URL. |
| `apps/web/src/_pages/home/ui/home-feed.client.tsx` | 67 | Retain: synchronize canonical URL with incoming query; interactive changes already use handlers. |
| `apps/web/src/_pages/library-discovery/ui/series-journey-controls.client.tsx` | 183, 214 | Retain: lazy reveal IntersectionObserver and return-target DOM scrolling. |
| `apps/web/src/_pages/library-discovery/ui/series-learning.client.tsx` | 80 | Retain: client-only remembered purchase-row cache for navigation geometry. |
| `apps/web/src/_pages/material-authoring/ui/material-authoring-page.client.tsx` | 58L | EF-3: redundant draft-ref layout assignment. |
| `apps/web/src/_pages/material-reader/ui/reader-return-navigation.client.tsx` | 25 | Retain: observe whether top controls left viewport. |
| `apps/web/src/_pages/product-task/ui/agent-phrase.client.tsx` | 20 | Retain: copy-feedback timer cleanup. |
| `apps/web/src/_pages/task-submissions/ui/task-submissions-runtime.client.tsx` | 76 | EC-2: retain accepted feedback revision in layout runtime; measure provider updates. |
| `apps/web/src/entities/material/model/reading-context.client.tsx` | 110L, 125 | Retain: hydration-safe external-store publish and per-material registration. |
| `apps/web/src/entities/material/ui/material-blocks/material-agent-prompt.client.tsx` | 27 | Retain: copy-feedback timer cleanup. |
| `apps/web/src/features/account-access/model/use-telegram-link-flow.client.ts` | 112, 126 | Retain: latest callback ref plus focus/visibility listeners for external Telegram return. |
| `apps/web/src/features/account-access/ui/account-telegram-onboarding.client.tsx` | 42, 58 | Retain: clear persistent dismissal on sign-out; open/focus browser dialog. |
| `apps/web/src/features/ai-engineering-course/ui/course-film.client.tsx` | 116, 135, 151, 194, 214, 237 | Retain: alternative dynamic module, canvas paint, fonts/resize, visibility, animation frames, reduced-motion poster. |
| `apps/web/src/features/ai-first-product/ui/ai-first-process-artwork.client.tsx` | 26 | Retain: external artwork mount/unmount. |
| `apps/web/src/features/billing-admin/model/use-owner-enrollments.client.ts` | 13 | Retain: enrollment announcement subscription. |
| `apps/web/src/features/billing-admin/ui/access-summary-panel.client.tsx` | 18 | Retain: enrollment/invitation subscriptions with cleanup. |
| `apps/web/src/features/billing-admin/ui/invitations-panel.client.tsx` | 62 | Retain: invitation announcement subscription. |
| `apps/web/src/features/billing-admin/ui/people-panel.client.tsx` | 71 | Retain: enrollment announcement subscription. |
| `apps/web/src/features/billing-admin/ui/subscription-sale-confirmation-dialog.client.tsx` | 28 | Retain: dialog lifecycle and focus restoration. |
| `apps/web/src/features/billing-admin/ui/tribute-operations-panel.client.tsx` | 36 | Retain: enrollment announcement subscription. |
| `apps/web/src/features/billing-checkout/ui/checkout-flow.client.tsx` | 309 | Retain: automatic quote synchronization to selected conditions. |
| `apps/web/src/features/billing-checkout/ui/purchase-return.client.tsx` | 217 | Retain: externally confirmed purchase refresh/announcement; dedup guards. |
| `apps/web/src/features/billing-contact/model/use-billing-contact.client.ts` | 25 | Retain: fact-channel subscription; EC-1 measures per-consumer channel cost. |
| `apps/web/src/features/billing-contact/ui/billing-contact-panel.client.tsx` | 49 | EF-2: currently unused parent callback effect. |
| `apps/web/src/features/billing-subscription/model/use-current-billing.client.ts` | 34 | Retain: fact-channel subscription; EC-1 measures per-consumer channel cost. |
| `apps/web/src/features/billing-subscription/model/use-own-enrollments.client.ts` | 15 | Retain: enrollment announcement subscription. |
| `apps/web/src/features/billing-subscription/ui/enrollments-panel.client.tsx` | 37 | Retain: admission query refresh on enrollment announcement. |
| `apps/web/src/features/bookmarks/model/use-bookmark-changes.client.ts` | 9 | Retain: Account-scoped bookmark announcement subscription. |
| `apps/web/src/features/client-telemetry/api/use-render-error-report.client.ts` | 13 | Retain: external error telemetry. |
| `apps/web/src/features/library-catalog/ui/material-catalog.client.tsx` | 48 | Retain: infinite pagination IntersectionObserver. |
| `apps/web/src/features/library-discovery/ui/course-reading.client.tsx` | 134 | Retain: keep active lesson visible in DOM rail. |
| `apps/web/src/features/material-assets/ui/material-image-delivery.client.tsx` | 38 | Retain: restore focus after modal viewer disconnects. |
| `apps/web/src/features/material-assets/ui/material-image-viewer.client.tsx` | 95, 117, 126, 142 | Retain: latest bounds ref, dialog lifecycle, resize measurement, nonpassive wheel listener. |
| `apps/web/src/features/material-assets/ui/material-responsive-image.client.tsx` | 40 | Retain: observe live column/theme; EC-3 measures delayed initial image discovery. |
| `apps/web/src/features/material-video/ui/material-primary-video.client.tsx` | 98 | Retain: external player lifecycle/session/progress synchronization. |
| `apps/web/src/features/material-video/ui/material-video-authoring.client.tsx` | 77, 128, 177, 188 | Retain: transfer cleanup/latest callback refs/reconciliation; EF-1 addresses deletion poll concurrency. |
| `apps/web/src/features/notification-preferences/model/use-notification-preferences.client.ts` | 20 | Retain: notification fact-channel subscription. |
| `apps/web/src/features/product-modes/ui/product-mode-hint.client.tsx` | 25 | Retain: record browser-stored hint exposure. |
| `apps/web/src/features/reading-progress/ui/reading-provider.client.tsx` | 65, 71, 74 | Retain: Account-scoped announcements, clear other-account cache, sign-out submit listener. |
| `apps/web/src/features/reading-progress/ui/saved-reading-action.client.tsx` | 41 | Retain: remove stale denied mutation-cache entries when access becomes available. |
| `apps/web/src/features/reading-progress/ui/visible-material-open.client.tsx` | 56 | Retain: intersection/visibility-gated open command; per-Account command deduplication. |
| `apps/web/src/features/storage-notice/ui/storage-notice.client.tsx` | 70 | Retain: observe notice height and set/remove document CSS space. |
| `apps/web/src/features/terms-acceptance/ui/welcome-dialog.client.tsx` | 20 | Retain: upgrade server-rendered dialog to browser modal while keeping focus. |
| `apps/web/src/shared/lib/autosave/use-autosave.ts` | 34L, 95, 133, 143 | Retain: latest callback/snapshot ref, save debounce, beforeunload guard, guarded navigation registration. |
| `apps/web/src/shared/lib/use-live-search-value.client.ts` | 10 | Retain: live-search debounce timer. |
| `apps/web/src/shared/ui/body-fragment-navigation.client.tsx` | 8 | Retain: hash navigation, open details and scroll browser DOM. |
| `apps/web/src/shared/ui/hide-mobile-navigation.client.tsx` | 14 | Retain: acquire/release global DOM navigation marker. |
| `apps/web/src/shared/ui/hide-public-footer.client.tsx` | 14 | Retain: acquire/release global DOM footer marker. |
| `apps/web/src/shared/ui/product-removal-confirmation-dialog.client.tsx` | 28 | Retain: browser dialog lifecycle. |
| `apps/web/src/widgets/application-shell/ui/application-shell.client.tsx` | 62 | Retain: responsive scroll-owner listeners and transfer. |
| `apps/web/src/widgets/material-authoring/ui/material-asset-upload-controls.client.tsx` | 75, 83, 94 | Retain: abort upload requests, editor transaction subscription, beforeunload guard. |
| `apps/web/src/widgets/material-authoring/ui/material-document-editor.client.tsx` | 149, 237, 256 | Retain: image URL cleanup, menu focus/outside dismissal, editor editability synchronization. |
| `apps/web/src/widgets/material-authoring/ui/use-material-block-controls.ts` | 125 | Retain: editor transactions, resize/mutation measurement observers and RAF cleanup. |

## Limitations and planning order

Start with EF-1 because its permitted concurrency affects server work and state ordering.
Treat EF-2 and EF-3 as small cleanup tasks, with no promised timing gain.
Collect production traces before selecting EC-1 through EC-4 as optimization projects.
This report does not claim exhaustive frontend bundle, RSC waterfall, image or CSS coverage beyond the effects and inspected callers.
No local tests, production build, CI, release or deployment were run for this read-only audit.
