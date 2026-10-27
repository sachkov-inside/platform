---
version: 1
slug: "admin-workspace"
primary_target: "apps/web/src/widgets/authoring-shell/ui/authoring-shell.client.tsx"
related_targets: ["apps/web/src/shared/ui/workspace-tabs.client.tsx", "apps/web/src/_pages/content-collections/ui/product-editor-page.client.tsx", "apps/web/src/widgets/material-authoring/ui/material-authoring-workspace.client.tsx", "apps/web/src/features/billing-admin/ui/billing-admin-view.client.tsx", "apps/web/src/_pages/sales-funnel-report/ui/sales-funnel-report-view.tsx"]
---

# Admin workspace

## Purpose and authority

Mode: **Operate**. The author finds a content or management task, works in a bounded section,
and retains drafts and operation state while changing local tasks. The owner selected prototype A
for the light, quiet workspace; that selection is directional approval, not final production
visual acceptance. The implementation is prepared in issue #1617. Finish review resolved all
three material corrections. Owner final production visual GO is pending.

The platform palette and fonts remain owned by `apps/web/app/globals.css` and `DESIGN.md`.
This surface adds no palette. Public/member navigation and Reader composition retain their
existing commitments. The earlier product-editor brief records #425 provenance; this brief
records the #1617 task-tab composition that supersedes its continuous editor layout.

## Composition and responsive behavior

Since #1720 the shell follows specification #1717 (decisions 2, 8 and 13); the menu is defined
once in `src/widgets/authoring-shell/model/navigation.ts`. At `64rem` and above, a light sidebar
(232px) holds «Обзор», then «Контент» (products, Materials, topics), «Ученики» (people,
submissions) and «Продажи» (payments, payment links, discounts, sales funnel); every item has a
lucide icon and label, and «Сдачи» carries the counter of submissions without author feedback.
Items whose screens later tickets build link to today's pages. Public-site links stay separate at
the bottom. No communications route is introduced. A global search row sits above the page and
`⌘K`/`Ctrl+K` opens the same search dialog. Current route is marked by `aria-current`, a light
card surface, a fine border and an orange icon.

Below `64rem`, a top row names the section and opens search; sibling sections of the current group
appear as tabs under it on section roots. A fixed bottom panel (safe-area aware, 44px+ targets)
holds «Обзор», «Люди», «Продажи», «Сдачи» and «Ещё»; «Ещё» opens a modal sheet with the remaining
sections and site links, which closes on route change, Escape or the backdrop.
At narrow mobile widths the document scrolls naturally. From `48rem` the task content owns its
scroll region. Shared page bodies are bounded at 1280px, with 36px/40px/64px vertical/horizontal/
bottom padding on desktop and 24px/16px/48px below `48rem`. These are local composition values,
not additions to the shared token scale. Shared admin page titles use 28px on desktop and 24px
on narrow screens; Material lists use their implemented 1.75rem title. Mobile fields use 16px.

Lists use readable rows and fine separators. Product/topic covers appear only when assigned;
there is no automatic blue placeholder artwork. Warm canvas and card surfaces keep work light,
graphite buttons carry primary actions, and orange stays a restrained task/focus signal.

## Task boundaries

`WorkspaceTabs` retains every panel in the mounted page and hides inactive panels with `hidden`.
Drafts, preview state and retry identities survive a local task switch. Tabs wrap on mobile,
use a 44px minimum target, and support ArrowLeft/ArrowRight, Home and End with roving focus.

- Product editor: «Программа», «Описание и обложка», «Материалы продукта», «Настройки».
  ImportedProduct source-owned restrictions remain in force.
- Material editor: «Содержимое», «Параметры», «Обложка и видео», «Карточка ссылки».
  Save, publication and Preview retain their application contracts.
- People/access: «Люди и доступ», «Тарифы», «Приглашения», «Сводка».
- Sales/payments: «Платежи», «Предложения», «Ссылки на оплату», «Наборы»,
  «Назначения и перенос», «Служебные операции». The last group separates grant/bulk actions
  from account classification. Offer benefits use readable named choices.
- Sales funnel: «Воронка», «Ожидание набора», «Анкетные скидки».

Payment state filtering stays visible. Account, kind and row limit live in a native additional
filters disclosure; collapsing it preserves field values. Below the `sm` breakpoint, a payment
row presents state and amount first, kind and access second, and a wrapping opening action last.
Larger screens retain the table. Banking state, access and receipt remain distinct facts.
The [operation inventory](../../../../docs/research/2026-10-20-admin-operations.md) maps the existing
operations retained by this grouping.

## Evidence and limits

The [#1617 evidence directory](../../../../docs/evidence/issue-1617/admin-ui/) contains 18 PNGs:
products, product editor, Materials, Material editor, topics, people, payments, analytics and
submissions, each at 1440px and 390px. Captures show finished Storybook play states with settled
fonts and document/main scroll at the top. People finishes with an empty source-filter result,
analytics on waitlist, and Material editor on parameters. These viewport captures do not show
all offscreen controls or every route state.

`measurements.json` records equal scroll/client width and zero axe WCAG A/AA violations in all
18 captured states. This evidence and the correction verdict do not constitute owner acceptance,
merge, release or verification of unseen states.
