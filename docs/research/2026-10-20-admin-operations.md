# Admin operations audit, 2026-10-20

Read-only primary-source inventory. Scope: `apps/web/src/features/billing-admin/ui`, `_pages/access-admin`, `_pages/communications`, their exact invoked browser adapters and focused callers. No repository edits. Paths below relative to repository root. A suggested grouping changes presentation only; it does not authorize new business operations.

## Critical routing boundary

- Active Platform surfaces: `/authoring/billing` composes `BillingAdminPanel`, `/authoring/access` composes AccessAdminPage → AccessAdminSection.
- Communications source exists but **is deliberately inaccessible in Platform**: `apps/web/app/authoring/communications/layout.tsx` calls `notFound()` unconditionally. Both the funnel page and broadcasts page are inside this layout. `test/e2e/communications.spec.ts` requires both routes to return not found, and `test/fullstack/communications.spec.ts` requires this too. No shell communications links. Therefore do not restore Telegram management simply because dormant components exist. It would change an explicit runtime contract, not merely regroup existing UI.

## Existing surface and state ownership

`AccessAdminSection` offers four tabs: Тарифы, Приглашения, Люди и доступ, Сводка. `AccessSection` keeps every tab mounted but hidden. Its comment explicitly preserves catalog revisions, pending commands and retries across tab switches. Tabs have ARIA tablist/tabpanel, roving focus and circular arrow navigation.

`BillingAdminPanel` owns shared catalog/cohort/payment/refund/grant/classification/batch state and a repeatable operation registry. `BillingAdminView` renders all of these sequentially, explaining much of its long scroll:
1. EnrollmentAdminPanel, ActivationRulesPanel, SubscriptionSourcePanel, TributeOperationsPanel.
2. CatalogSection: catalog, offer, option, promotion.
3. CohortSection.
4. PaymentLinksPanel and SurveyRespondentsPanel.
5. PaymentsSection: list/detail, refunds, cancel renewal.
6. ClassificationSection.
7. GrantsSection: account grants, extend/revoke, batch.

Most sections already have focused modules; preserving them behind small routed tasks is possible without new backend API. Panels that hold repeatable-operation identity must not be remounted mid-request merely to shorten a page.

## Complete operation inventory: billing and access

Legend: R = read/local presentation, W = persisted command, P = preview or explicit second action. User-entered reasons remain required where existing commands require them. Revision/operation IDs are machine context, not fields that can simply be deleted from payloads.

| Existing module | Operation and exact adapter | Required context / inputs | Constraints and suggested task |
| --- | --- | --- | --- |
| CatalogSection | R current offers/options/promotions list, existing tier list, content coverage. Local `Новый тариф` and `Редактировать состав` load editor. | Loaded offers, content products, all tier revisions. | Catalog list + one selected offer editor. Do not render all create/edit forms all the time. |
| CatalogSection | W create/update offer `saveBillingOffer` | offer id/name, benefits (including optional per-benefit month periods), assignment availability, coverage (whole platform OR chosen product IDs), expectedRevision if update. | Parses capability identifiers; unknown capabilities reject. Standalone material coverage is not supported by new editor and existing materialIds are warned about. Editing offer creates/replaces revision, existing enrollments preserve snapshot. Task «Состав тарифа». |
| CatalogSection, TariffsPanel | W publish/unpublish offer `publishBillingOffer` / `unpublishBillingOffer` | loaded offer id + expected revision | Publish sale is distinct from saving offer. Removing sale does not revoke existing access. Current catalog has a sale action too, not only Access page. Preserve recurring-sale confirmation at all paths. Task «Продажа». |
| TariffsPanel | W save eligibility `saveBillingOffer` via `eligibilitySave` | whole current offer snapshot; selected eligibility. choices normally everyone/invitation_only, retains legacy Tribute eligibility when present. | Helper preserves coverage/assignment attributes. Changing unsaved dropdown must not change subsequent sale-warning decision until save completes. |
| CatalogSection | W archive offer `archiveBillingOffer` | id + expected revision | Archive affects availability, not issued access. Existing explicit form action, no extra confirmation dialog. |
| CatalogSection | W create/update payment option `saveBillingPaymentOption` | option id, offer id, months, priceKopecks, mode subscription/one_time, expectedRevision if update | Existing option mode immutable, one offer uses one sales mode per UI copy. Subscription months are billing period; one-time months do not define benefit term. Task «Цена» nested under offer. UI may accept rubles but must convert exactly to existing kopecks adapter. |
| CatalogSection | W archive option `archiveBillingPaymentOption` | option id + revision | Keeps granted rights. Row action in selected offer. |
| CatalogSection | W create/update promotion `saveBillingPromotion` | id/name, percent, code, startsAt, endsAt, offer IDs, option IDs, max applications, expected revision if update | Task «Скидки»: list then single editor, not adjacent to every offer form. |
| CatalogSection | W archive promotion `archiveBillingPromotion` | promotion id + revision | Explicit archive action. |
| CohortSection | R list/select existing cohort; W `saveBillingCohort` | product id, cohort name, stage, startsOn date or null, nextEvent text, post-start priceKopecks or null, revision if existing | stage values from cohortStageSchema. Changes visible publicly after save; announcement stage never accepts payment. If cohorts load failed (`null`), cannot pretend new empty list or guess revision. Task per product «Набор / продажи». |
| PaymentLinksPanel/View | R list/load more/refresh; W `createPaymentLink` | eligible one-time payment option + optionRevision, discount integer 0..99 OR amountKopecks, optional future expiry | Preview price is local PaymentLinkSummary. Amount 1..1,000,000 ₽, no free link. Date input Moscow, payload ISO. Public price unchanged. Task «Ссылки на оплату»: list + create sheet. |
| PaymentLinksView | R copy URL (manual field fallback); R open checkout in new tab; W `revokePaymentLink` | chosen link, its current state/revision adapter context | Revoke enabled only active. Pending/unknown bank result reserves link and disables revoke. Paid link revoke does not refund or undo rights. Creation/copy do not send messages. |
| SurveyRespondentsPanel/View | R read/refresh archive, expand full respondent list | archive totals issued/purchased; username historical row facts | Read-only, no upload/new issuance in this view. Existing #payment-links anchor must become real route/link if tabs split. Task «Ссылки → Архив анкетных скидок». |
| PaymentsSection | R `listBillingPayments` with pagination; R select via list or `readBillingPayment` by ref | optional account id, optional state, optional kind, limit (currently 50), cursor; selected purchaseRef | States prepared/sent/unknown/pending/authorized/confirmed/failed. Kinds initial/one_time/renewal/upgrade. Detail includes amount/refund totals/fiscalization/terminal/audit. `readBillingPayment` adapter fetches all audit pages with loop/cross-payment safety checks; do not replace with shallow single fetch. |
| PaymentsSection | W observation `reconcileBillingPayment` | purchaseRef | «Сверить с банком» may update authoritative observed state, not a refund/write amount. Task payment detail «Операции». |
| PaymentsSection | R `readBillingRefunds` | purchaseRef | Shows decisions and attempts, remaining refundable total. **No refund-execution operation in current UI**. Copy says refund only in T-Bank cabinet. Do not invent refund button in redesign. |
| PaymentsSection | W `cancelOwnerSubscription` | accountId, expected subscription revision, reason | Stops renewal, preserves paid term. Account context should select/read existing revision only when adapter provides it; do not guess revision from payment revision. Current form expects explicit revision. Can keep advanced form until reliable context exists. Task account «Подписка». |
| ClassificationSection | R `readAccountClassification`; W `classifyAccount` | accountId, revision (0 for no prior decision), classification confirmed_new/confirmed_legacy/unknown, source evidence, bridgeEnabled, tributeStopped, reason | Flags affect recurring access decision. Keep as an explicit advanced account task, not silent inferred toggles. |
| GrantsSection | R `readAccessGrants` | accountId | Displays each independent grantRef/revision/source/period. Account detail «Основания». |
| GrantsSection, PeoplePanel | W `extendAccessGrant`; W `revokeAccessGrant` | grantRef, revision, reason; extend validUntil ISO offset or null | Only relevant manual/legacy grounds. Revoke one ground leaves other grounds. Existing direct action with reason, no universal confirm dialog. |
| GrantsSection | P `previewAccessGrantBatch`, W `applyAccessGrantBatch` | parsed pipe-delimited rows for grants and/or classification; then returned previewRef/revision + confirmed row keys | Preview does not grant or classify; apply uses confirmed rows from that exact preview. Preserve separate inspect/apply task. Rows contain account, source/evidence, capabilities/period or classification flags. Task «Служебные операции → Массовая выдача». |
| PeoplePanel/View | R `listPeople`, filters and load more | offer filter (includes archived), source, state, cursor | Existing view shows active grounds and those ended in prior 30 days. List of people plus one expanded person; avoid mounting all forms visibly. |
| PeoplePanel/View | W change enrollment ground `changeTariffAssignment`: change_term/revoke/restore | selected PersonGround enrollment id/revision/current terms; date/reason where supported | `groundActions` restricts actions by source. Manual/course enrollment terms must not be inadvertently altered on revoke/restore. Date shown as last inclusive Moscow day, payload next day start. |
| PeoplePanel/View | W change grant ground via `extendAccessGrant`/`revokeAccessGrant` | selected PersonGround | Paid one-time/Platform payment grounds do not expose these local arbitrary term actions. People view explains those use refund/cancel instead. Keep source-dependent allowed actions. |
| PeoplePanel/View | W `assignTariffAssignment` | selected account, assignable nonarchived offer/tier snapshot, reason; generated origin/manual/sourceRef, stable startsAt | Free manual assignment, no payment/schedule. Each benefit term derives from tier. Never turn this into checkout or invoice. |
| ProductRevocationPanel | P `previewProductRevocation`, then W `revokeProductAccess` | selected account + product, returned aggregate revision/affected grounds, required reason | Revokes product across all current grounds, not just chosen one. Explicit second destructive submit after preview lists impact. Keeps other products, payments/progress. Changing product resets preview; failure invalidates it. Account detail «Отозвать продукт» separate from revoke one ground. |
| EnrollmentAdminPanel | R `lookupSubscriptionRecipient`, R `readTariffAssignments` via hook | **verified exact Telegram identity, not username**; selected found account | Ambiguous/not found blocks assignment. Loaded recipient can be explicitly selected and assignments refreshed. Task «Найти получателя» for users not reached through People list. |
| EnrollmentAdminPanel | W `assignTariffAssignment` | account, assignable tier id/revision; origin manual/course; permanent sourceRef; reason; generated stable startsAt; terms endsAt:null/endPolicy:fixed; billingRef:null. For course, verified identity + policyRef. | Course verification evidence required; do not replace exact identity with user-friendly unverified username. No billing created. |
| EnrollmentAdminPanel | W `changeTariffAssignment` | selected enrollment/revision, change_term/revoke/restore, reason; existing startsAt/endPolicy and applicable endsAt | Original manual/course terms are preserved by UI. Other origins permit end change under adapter/domain restrictions. |
| EnrollmentExpansionPanel | P `previewEnrollmentExpansion`, W `applyEnrollmentExpansion` | selected tier current revision, selected existing enrollment IDs + expected revisions + previous tier revisions, reason; returned previewRef | Must be saved new revision of same tier that only expands rights. Preview expires. Apply updates selected assignments preserving term/revoke state. Do not replace with generic «Apply latest» on all people. |
| ActivationRulesPanel | R listActivationRules; W saveActivationRule create/update; W publish/pause via same adapter | new UUID, name, immutable code/sourceRef, tier id/revision, startsAt Moscow, verificationMode course_membership, published flag, reason; existing revision for changes | Existing rule update only changes published or pinned tier snapshot; updating tier affects new activations, not issued assignments. Code picks rule, does not prove purchase. Task «Доступ → Активация курса», list + one selected rule. |
| SubscriptionSourcePanel | W registerSubscriptionSource | policyRef, verified identityRef, reason; origin:course, stable checkedAt/startsAt now, endsAt:null | Saves verified source before registration; does not itself create account/payment/right. Separate from Tribute import. Task «Доступ → Подтверждения курса». |
| AccessSummaryPanel/View | R readAccessSummary | no user fields, asOf | Active by offer/type paid/gift/course, invitation funnel totals, attention ending 7 days/failed charge 7 days, revenue/refunds. Requery on enrollment/invitation announcements. Task «Обзор» not editable form. |
| InvitationsPanel/View | R listInvitations, state filter, cursor/load more; W issueInvitation | offerId, mode:purchase, optional private note | Current form only purchase invitation, not gifting. Generated link/deep-link copy does not automatically send to customer. Live invitation expiry behavior source model; preserve result labels. |
| InvitationsPanel/View | R copy URL or bot start argument; W revokeInvitation | selected invitation id + revision; only live and unused per model | No arbitrary lifetime field in current purchase invitation form. Revoke cannot retroactively cancel resulting purchase. Task «Доступ → Приглашения». |

## Tribute operations (all currently mounted on billing page)

Primary `tribute-operations-panel.client.tsx`, `tribute-operations-view.client.tsx`, exact adapters in `api/tribute.browser.ts`:

1. R `tributeStatus`: metrics, unconfirmed sources, imports, sources, inbox events, paginated page navigation; refresh. Preserve unavailable/error separately from empty.
2. W `tributeSavePolicy`: stable policyRef for new source, external Subscription ID from confirmed Tribute source, assignable tier id/current revision, optional temporaryUntil, reason. Existing policies carry expectedRevision, and immutable context is not user-editable. Source editing is its own small settings task.
3. R CSV template download, upload file (≤256KB), or edit CSV text; P `tributePreview`: batchRef + parsed rows (≤100). Do not infer unknown identity/date from username. confirmed_period vs separately allowed temporary_membership remain distinct.
4. W `tributeApply`: only selected eligible row refs of returned previewRef. Preview expires; source/link change requires new preview. Preserve existing checkboxes/row outcome before apply.
5. W recovery: reissues exactly persisted apply command from sessionStorage key `inside.tribute.pending-apply.v1`. New preview/application blocked while unresolved prior apply exists. Do not clear recovery data during tab/route change, do not regenerate operation ID on retry. Server durable receipt handles refresh.
6. W `tributeDismissImport`: old pending import previewRef + expected revision + reason explicitly closes unhandled rows without changing rights.
7. W `tributeReconcile`: sourceId + revision + action retry/revoke/restore + reason. restore additionally needs confirmed startsAt/endsAt + verificationRef, with end after start. Independent source revoke, not all person access revoke.
8. W `tributeRetryEvent`: inboxId/revision, retry/reject + reason, only received/pending_reconciliation events. Successful/event status remains visible.

Safe UI split: «Перенос Tribute» tabs «Сверка» (upload→preview→apply wizard), «Источники» (list/details/reconcile), «События», «История сверок». Policy setup lives in source details or settings. Long explanatory text can be in help disclosure, but unknown/temporary/evidence warnings belong directly in their affected step.

## Dormant communications inventory, not active Platform navigation

### Funnels Workspace

Primary `ui/communications-workspace.client.tsx`, adapters `api/communications.browser.ts`:
- R listFunnels cursor/first/refresh, readFunnel to select, new local draft.
- W saveFunnel: expectedRevision + draft (funnelId,name,isDefault,entryResponse,steps,sources). Default changes effective on publish. IDs stay stable while editing/reordering.
- Local content assembly: select saved Telegram posts into immediate entry response, delayed steps, or common introduction; reorder/remove parts, replace from saved posts; delayed step add/remove/reorder and delay; source add/remove/name/code, persisted source code readonly. Source bot deep links can open in new tab.
- W readIntro/saveIntro: shared intro independent of selected funnel, with intro revision + parts. No per-customer arbitrary editing implied.
- P previewFunnel saved clean revision: shows added/edited/deleted/reordered IDs, eligible audience, completed participants receiving new steps, invalid targets/publication/free/incomplete errors. W publishFunnel only from same matching clean revision and preview state in UI. Separate publish from save.
- W changeFunnelLifecycle pause/resume/archive/restore; restore returns paused. Editing and lifecycle disabled while busy/dirty where applicable.
- R readDeliveries selected saved funnel/cursor/refresh/first; inspect message snapshot, each part status, attempts and diagnostic code.
- W skipDelivery/retryDelivery selected deliveryId+partId+expectedRevision. Input includes duplicateRiskAccepted; **unknown send result requires explicit checkbox accepting potential duplicate before retry**. Do not collapse this to plain retry button.
- R resolveTemplate imports referenced saved Telegram post (ID/link), no Telegram text/media upload service is introduced.

### Saved Post Library shared by dormant funnels and broadcasts

`post-library.client.tsx`, adapters re-exported from broadcasts.browser:
- R readSavedPosts cursor/refresh/select; existing text/media/entities displayed as captured from Telegram.
- W savePost modifies button text, HTTPS URL, row (1..20 UI mapping to 0-based payload), add/remove buttons up to 20, expectedRevision + template snapshot. Source text/media creation is done in Telegram; PartsEditor guides this rather than reproducing editor.
- W samplePost «Образец себе» sends actual Telegram sample only to operator. sampleOperation localStorage preserves retry identity after ambiguous response. Prevent dirty sample/use until saved. Choosing saved post snapshots contents into draft, future library changes do not rewrite chosen messages.

### Broadcasts editor and analytics

`communications-page.client.tsx`, `broadcast-editor.client.tsx`, `analytics-panel.tsx`, `broadcasts.browser.ts`:
- R readBroadcasts pagination, readBroadcast select/refresh; local new draft with UUID, parts[], audience all, no schedule.
- W saveBroadcast expectedRevision + parts/audience/scheduledAt. Build ordered parts from library or resolveTemplate; replace/reorder/remove; saved snapshot independence remains.
- Audience all contacts OR chosen funnel IDs (dedupe/exclude unsubscribed/blocked per copy). Existing waitlist audience fixed on loaded draft and disables arbitrary scheduling changes.
- Schedule datetime in user's resolved timezone converted to instant; future schedule saved as draft does not activate it.
- W launchBroadcast explicit «Запустить сейчас»/«Запланировать» after saved clean draft revision >0; on actual launch audience snapshot fixed. Resume keeps same snapshot.
- W pauseBroadcast running/scheduled, resumeBroadcast paused, cancelBroadcast except completed/cancelled. No extra confirmation modal exists in current editor; it is an explicit action separate from save.
- R local preview and load latest, expose unsaved status/failures. Do not silently execute launch on save.
- R readStatistics/readDeliveries scoped all/funnel/broadcast with separate contact/delivery cursors; select contact → readEntries cursor history; close history/reset scope/cursors. Analytics separate from editor is safe presentation grouping if this UI is ever explicitly restored under its owning app.

## Explicit-confirm / state-sensitive matrix

- Subscription sale to everyone: existing SubscriptionSaleConfirmationDialog. Rule handles mixed active one-time + recurring options; archived recurring/no active options do not require it; removing sale does not. Decision uses saved eligibility and latest row revision; dialog Cancel focus/return/Escape/Tab behavior is tested.
- Product-wide revoke: mandatory preview impact list and aggregate revision; reason + second destructive submit.
- Enrollment expansion: preview then apply previewRef.
- Grant/classification batch: preview then apply confirmed rows/revision.
- Tribute: preview + selected rows + recovery receipt. Restore requires proof period; unresolved import dismiss/reject needs reason.
- Communications unknown-delivery retry: duplicate-risk checkbox; actual sample and launch are sends, not previews.
- Other archive/revoke/cancel actions currently use explicit buttons/forms and required reasons where defined. No blanket second-confirm dialog in source. Do not invent that it already exists, and do not remove action visibility just because no modal exists.

## Recommended grouping preserving existing commands

1. «Продажи»: current offers list; selected offer tabs «Состав», «Цены», «Продажа»; sibling «Скидки», «Ссылки на оплату», «Платежи». Product cohort settings next to product context, not above all payments. Payment detail contains audit/refunds/bank reconciliation.
2. «Доступ»: «Люди», «Приглашения», «Обзор». Person detail tabs «Основания», «Назначения», «Подписка»; rarely needed classification and source evidence in «Дополнительно». New assignment opens focused form. Keep verified identity lookup workflow available for person not selected from People.
3. «Настройки доступа / служебные операции»: activation rules, course source confirmation, Tribute transfer (its own four small tasks), mass grant/classification import. They remain discoverable navigation, not buried forever or dropped.
4. Historical survey archive accessible from payment links page; actual routed link replaces `#payment-links` across task boundaries.
5. No Platform communications menu until ownership/runtime contract explicitly changes. Existing dormant editor inventory is retained for completeness, not implementation scope expansion.

Machine IDs/revisions can be hidden/read-only/autofilled ONLY if loaded by existing operation. SourcePolicyRef, verified identity and reason are domain inputs, not disposable technical noise. Offer/payment-option forms presently expose raw IDs because no list/selection seam was built; redesign can use selected loaded snapshot but must keep create IDs stable across retries and preserve expectedRevision semantics. For cancel renewal/classification, do not infer a revision from another aggregate.

## Callers and verification sensitive to composition changes

### Stories

- `_pages/access-admin/ui/access-admin-page.stories.tsx` (production composition wrapper, multiple loaded/error/empty/mutation behaviors).
- `features/billing-admin/ui/billing-admin-page.stories.tsx` passes actual BillingAdminPanel with MSW fixtures; expects all long-form controls on one page today.
- `tariffs-view.stories.tsx`, `subscription-sale-confirmation-dialog.stories.tsx`: recurring-sale warning, cancellation/focus, catalog revisions.
- `payment-links-view.stories.tsx`, `survey-respondents-view.stories.tsx`: create/preview/copy/revoke/archive-specific statuses and #payment-links semantics.
- `tribute-operations-view.stories.tsx`: preview/row selection, restore/closed leftovers/history/busy/error states.
- `product-revocation-panel.stories.tsx`: preview invalidation/revocation exact payload.

### Browser tests with composition assumptions

- `test/fullstack/enrollment.spec.ts`: /authoring/billing, «Оплата и права», «Тарифы и назначения», «Новый тариф», «Сохранить предложение», exact field labels, recipient selection, course rule creation, assignments/revoke/restore, expand tier snapshots, open personal cabinet convergence. This requires adapting navigation to new tasks, not weakening behavioral checks.
- `test/fullstack/billing-admin-access.spec.ts`: /authoring/access, named listitem per tariff, buttons «Включить продажу», «Сохранить допуск», modal «Включить продажу подписки всем?», Cancel focus, keyboard trap, reload/stale revision and saved eligibility. Preserve them or update locators to equivalent real UI.
- `test/fullstack/individual-payment-links.spec.ts`: link create/bank reservation/checkout/revoke lifecycle; inspect when moving link workflow.
- `test/e2e/communications.spec.ts`, `test/fullstack/communications.spec.ts`: deliberate not-found routing, not dormant editor tests.

### Focused module contracts

- `test/module/billing-admin-access.test.ts`: groundActions restrictions, inclusive Moscow date conversion, mixed option warning, preserved offer attributes, people filters/limits, summary.
- `billing-admin-invitations.test.ts`: live/used labels, revoke permissions/revision, optional note/no gift lifetime in purchase flow, cursor filters.
- `billing-admin-cohort.test.ts`, `billing-admin-batch-rows.test.ts`, `tribute-import.test.ts`, `billing-payment-audit.test.ts`, `billing-admin-bff.test.ts`, `communications-bff.test.ts`, `communications.test.ts` protect input shape, evidence parsing and adapters, not just screen names.

### Cross-panel contracts easily broken by route split

`announceEnrollmentChange`/`subscribeEnrollmentChange`, invitation announcements and `refreshAccessRead` keep People/Summary/Tribute/other open views consistent. Query keys for owner-subscription-tiers, owner-enrollments, access-summary/people remain stable. All retry identity hooks, stable first-attempt startsAt/checkAt, current revision patching, and selected previews must survive normal tab switches. A cosmetic route split with remounting can cause duplicate operations or lose uncertain-command recovery unless state is intentionally lifted/persisted.

## Implementation map, issue #1617

This inventory records the pre-redesign source on `3e01ac915ff320bbbc7d97dfe2c9fb9a04b57a00`.
The implementation keeps the active routes and their production adapters. Its presentation map is:

| Route | Visible tasks |
| --- | --- |
| `/authoring/products` | Product list, search, creation, Home pin |
| `/authoring/products/[id]` | Programme; description and cover; product materials; settings (Home pin and community) |
| `/authoring/materials` | Search and publication filter; material rows and their existing lifecycle actions |
| `/authoring/materials/[id]` | Document; parameters; cover and video; link card. Mutation failures and validation guidance stay outside hidden tasks. |
| `/authoring/topics` | Search, creation and expandable topic editors |
| `/authoring/submissions` | Existing task submission list, filters, details and review actions inside the new authoring navigation |
| `/authoring/access` | People and access first; tariffs; invitations; summary |
| `/authoring/billing` | Payments; offers (catalogue, composition, prices, promotions); payment links and historical survey archive; cohorts; assignments/activation/course evidence/Tribute; service operations (grounds/batches and classification) |
| `/authoring/sales-funnel` | Shared product/chapter/date filters; funnel; waitlist; survey discounts; calculation help disclosure |

`WorkspaceTabs` hides inactive panels without unmounting them. Existing mutation hooks, stable retry
identities, preview objects and revision-bound commands remain owned by their feature adapters.
Offer and payment-option editors use selected loaded identities and revisions instead of transcription.
The benefit chooser serializes into the existing `offerBenefits` parsing contract, preserving default,
explicit permanent and finite per-benefit terms. Payment continuation uses the filters of the last
successful list response, including when a later filter request fails.
After a successful payment-option save, the browser reloads the canonical owner catalogue through
an authenticated, private no-store BFF read. Further catalogue writes wait for that refresh; a failed
refresh retries only the read. This preserves create-to-edit and repeated-edit revision checks.
Long offer and payment-option selectors show at most 20 matching rows plus the selected row, with
search across the complete owner list.

The new production UI still requires its finished responsive evidence and owner visual acceptance.
The prototype direction was selected on 2026-10-20; this selection does not constitute acceptance of
the production implementation. See [#1617](https://github.com/sachkov-inside/platform/issues/1617).
