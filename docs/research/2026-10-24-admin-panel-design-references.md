# Admin panel design references, 2026-10-24

Scope: design patterns for the owner admin (`/authoring`) of Inside. One owner; one-time purchase,
lifetime access, no subscriptions. Sections: Overview, Content (Products, Materials, Topics),
Learners (People with Product Access history, Task Submissions), Sales (Payments, Payment Links,
Discounts, Sales Funnel), Messages. Visual language stays: warm beige, orange accent, dark buttons,
Russian UI, Next.js + Tailwind + lucide, tokens in `apps/web/app/globals.css`.

Status: research input, not an accepted decision. Library choice and the earlier screen audit
live in [admin UI foundations](2026-10-20-admin-ui-foundations.md); the operation inventory and
the fact that Telegram communications routes are deliberately `notFound()` live in
[admin operations](2026-10-20-admin-operations.md). Do not re-enable Messages only because this
note lists it.

Evidence notes:

- Every URL below was fetched during this research unless marked *unverified*.
- Several domains blocked the fetch tool and were read with `curl` (Stripe docs, Shopify Help,
  Carbon, Atlassian, Apple HIG JSON).
- Old `polaris.shopify.com` and `polaris-react.shopify.com` pages now redirect to `shopify.dev`.
  Polaris React guidance was read from the MDX sources in the
  [Shopify/polaris repository](https://github.com/Shopify/polaris/tree/main/polaris.shopify.com/content).
  The removed Polaris data visualization page is cited from a
  [Wayback copy (Dec 2023)](https://web.archive.org/web/20231222020526id_/https://polaris.shopify.com/design/data-visualizations).
- "Inference" marks a conclusion drawn by this note, not stated by the source.

## 1. Information architecture and the Overview page

### What analogous products put on the home page

| Product | Home/overview composition | Source |
| --- | --- | --- |
| Shopify | 4 metric tabs (default last 30 days) over one chart; clicking a metric switches the chart. Order tasks grouped by type with counts (capture payment, fulfil, returns, chargebacks); task cards cannot be dismissed while open. Setup checklist before the first sale. Insights only above ~10 orders/week. | [Shopify Home](https://help.shopify.com/en/manual/shopify-admin/shopify-home) |
| Shopify Analytics | Default 90 days; comparison = previous period, previous year, custom or none; card title opens the full report; metrics for unused channels hidden. | [Overview dashboard](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard/using-the-overview-dashboard) |
| Stripe | Home shows performance charts plus "important notifications, like unresolved disputes". Three controls: range, interval, comparison period. Charts are estimates; exact numbers live in reports. | [Dashboard basics](https://docs.stripe.com/dashboard/basics), [Home charts](https://support.stripe.com/questions/dashboard-home-page-charts-for-business-insights) |
| Kajabi (mobile) | In order: Offers sold, Net revenue (after refunds and discounts), New customers, Opt-ins, Views. Closest analogue to Inside. | [Kajabi creator app](https://help.kajabi.com/en/articles/17175659-explore-the-kajabi-creator-mobile-app) |
| Kajabi (web) | Gross revenue, Refunds, Top offers, revenue by price type (one-time, plan, free), New contacts, Top customers. A widget that ignores the global date filter labels its own period. Status counts link to a pre-filtered list. | [Analytics overview](https://help.kajabi.com/hc/en-us/articles/360037065214-Analytics-Overview), [Net revenue](https://help.kajabi.com/articles/analytics/report-net-revenue) |
| Podia | Contacts, Sales (free and paid enrolments), Revenue, Pending; "Recent activity" feed including failed payments. | [Podia dashboard](https://help.podia.com/en/articles/11370401-navigating-your-podia-dashboard) |
| Gumroad | Per-day bars (views) with a sales line; conversion = buyers / viewers; referrer table sortable by any column. A forecast dot is shown only with enough history (at least 7 sales days in 4 weeks). | [Gumroad analytics](https://gumroad.com/help/article/74-the-analytics-dashboard) |
| Ghost | Hides revenue metrics when there are no paid members; default 30 days. | [Ghost dashboard](https://ghost.org/help/dashboard/) |
| Lemon Squeezy | Recent revenue and customers; setup checklist for a new store. | [Getting started](https://docs.lemonsqueezy.com/guides/getting-started) |
| Teachable, Thinkific | Transactions, average order, refund rate, coupon sales; revenue panel on home. *Unverified* (login wall / 403). | [Teachable](https://support.teachable.com/en/articles/11682566-sales-analytics-dashboard), [Thinkific](https://support.thinkific.com/hc/en-us/articles/360030719833-Admin-Dashboard-A-Closer-Look) |

### Principles

- A dashboard answers "are sales up?" at a glance; it is not an exploration tool
  ([NN/g, preattentive dashboards](https://www.nngroup.com/articles/dashboards-preattentive/)).
- "Numbers are meaningless without context": each KPI needs a comparison
  ([NN/g, chart types](https://www.nngroup.com/articles/choosing-chart-types/)).
- Most important data gets most contrast and area, top-left; remove everything else; keep one
  colour per data set across the dashboard
  ([Carbon dashboards](https://carbondesignsystem.com/data-visualization/dashboards/)).
- Every number states its period ("include a dimension of time")
  ([Polaris data viz, archived](https://web.archive.org/web/20231222020526id_/https://polaris.shopify.com/design/data-visualizations)).
- Prioritise critical values; unprioritised alerts cause fatigue
  ([NN/g, alert fatigue](https://www.nngroup.com/videos/alert-fatigue-user-interfaces/)).

### Metrics for a small one-time-purchase course seller (inference from the table)

Primary: net revenue (gross minus refunds), number of sales, new buyers/learners, refunds.
Secondary: top products by revenue, payment-link or source performance (from the funnel),
submissions awaiting review. Skip MRR, churn and subscription widgets entirely. Show conversion
only if the platform actually records views for the same population.

### Overview composition (inference)

1. Header: title, period selector (7 / 30 / 90 days, custom), comparison toggle.
2. KPI row: 3-4 metrics, each with value, period, delta vs previous period.
3. "Needs attention": rows with count and a link to the pre-filtered list (submissions to review,
   failed or pending payments, refunds to process, payment links expiring soon). Not dismissible
   while non-zero; hidden or collapsed to "all clear" when zero.
4. One main chart (revenue or sales over time), switchable by clicking a KPI (Shopify pattern).
5. Recent activity feed (purchases, access grants/revocations, submissions) with links to the
   person or payment.
6. Before the first sale: setup checklist instead of empty charts (Shopify, Lemon Squeezy).

## 2. Index tables (People, Products, Materials, Payments, Links, Discounts, Submissions)

### Layout and density

- Polaris resource index: single column; title and list-level actions on top; tabs (saved views),
  search, filters and sort above the table; rows; empty state when nothing exists
  ([resource index layout source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/patterns/resource-index-layout/index.mdx)).
- Carbon row heights: 24 / 32 / 40 (default) / 48 / 64 px; 64 only for two-line content; header,
  toolbar, batch bar and pagination match row height; hover on every row
  ([Carbon data table](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines)).
- Keep column counts low; show only what the task needs
  ([Polaris table](https://shopify.dev/docs/api/app-home/polaris-web-components/layout-and-structure/table)).
  Most important columns first; related ones adjacent
  ([NN/g data tables](https://www.nngroup.com/articles/data-tables/)).
- Primary column identifies the object (name plus secondary line); status comes second
  ([Polaris index table composition](https://shopify.dev/docs/api/app-home/patterns/compositions/index-table)).
- Shortest format per cell; wrap rather than truncate; truncated text gets a tooltip; leave empty
  cells empty, no "-" ([Primer DataTable](https://primer.style/product/components/data-table/guidelines/)).
- Right-align numbers with `tabular-nums`; units in the header, not repeated in cells; never centre
  ([Primer DataTable](https://primer.style/product/components/data-table/guidelines/),
  [Polaris data table source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/components/tables/data-table.mdx)).
- No buttons or links inside column headers
  ([Atlassian dynamic table](https://atlassian.design/components/dynamic-table/usage)).

### Row click, row actions, overflow menu

- Row click opens the detail page; the title is a real link (Polaris `data-primary-link`)
  ([index table source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/components/tables/index-table.mdx)).
- Fewer than 3 row actions: inline icon buttons; otherwise an overflow menu; on touch, the menu is
  always visible, never hover-only ([Carbon data table](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines)).
- Inline actions work for one or two options; more get crowded or hidden
  ([NN/g data tables](https://www.nngroup.com/articles/data-tables/)).
- Accessible names name the row ("Edit component 3"); after delete, focus moves to the next row
  ([Atlassian dynamic table](https://atlassian.design/components/dynamic-table/usage)).
- For deeper edits, a non-modal side panel keeps the table visible
  ([NN/g data tables](https://www.nngroup.com/articles/data-tables/)).

### Filters, search, saved views

- Polaris IndexFilters: tabs = saved views (query + filters + sort); "All" tab locked; 2-3
  promoted filters; sort in a popover with readable direction labels
  ([index filters source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/components/selection-and-input/index-filters.mdx)).
- Applied filter pills: self-explanatory values alone ("Refunded", not "Status: Refunded");
  disambiguate when needed; one pill per category
  ([filters source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/components/selection-and-input/filters.mdx)).
- Show the count of hidden applied filters; per-category clear and "clear all"
  ([Carbon filtering](https://www.carbondesignsystem.com/patterns/filtering/)).
- Instant apply for fast single-choice filters; batch "Apply" for multi-category or slow queries;
  dim results while updating ([NN/g applying filters](https://www.nngroup.com/articles/applying-filters/)).
- Store filters and search in the URL; give a visible way back to the default view
  ([Primer filter pattern](https://primer.style/product/scenario-patterns/filter/)).
- Search sits above what it searches, labelled by object ("Поиск по людям"), has a clear button,
  announces result count politely ([Primer search](https://primer.style/product/scenario-patterns/search/)).
- Stripe search understands `email:`, `status:`, `amount:` and opening an object by its ID
  ([Stripe search](https://docs.stripe.com/dashboard/search)).
- Linear separates display properties (which fields show) from filters (which rows show); "Save
  view" appears only after a filter is set ([display options](https://linear.app/docs/display-options),
  [custom views](https://linear.app/docs/custom-views)).

### Pagination

- Paginate above 50 rows (Polaris); start with 20 per page (Primer)
  ([index table source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/components/tables/index-table.mdx),
  [Primer DataTable](https://primer.style/product/components/data-table/guidelines/)).
- Pagination sits directly below the table, shows range and total; mobile drops per-page selector
  ([Carbon pagination](https://www.carbondesignsystem.com/components/pagination/usage/)).
- Avoid infinite scroll when users look for a specific record or compare; "Load more" with
  "N of M" is the compromise ([NN/g infinite scrolling](https://www.nngroup.com/articles/infinite-scrolling-tips/)).

### Empty, no-results, loading, error

- Three distinct empty states: no data yet (first use, one create action), no results (name active
  filters, offer reset), error (cause and next step, retry)
  ([Carbon empty states](https://www.carbondesignsystem.com/patterns/empty-states-pattern/),
  [Primer filter](https://primer.style/product/scenario-patterns/filter/)).
- Empty state replaces the whole table, without headers
  ([Carbon empty states](https://www.carbondesignsystem.com/patterns/empty-states-pattern/)).
- Never show "no records" while loading
  ([NN/g empty states](https://www.nngroup.com/articles/empty-state-interface-design/)).
- No indicator under 1 s; skeleton for 2-10 s full-page loads, matching real column widths; static
  headings render as text immediately
  ([NN/g skeletons](https://www.nngroup.com/articles/skeleton-screens/),
  [Primer loading](https://primer.style/product/ui-patterns/loading/),
  [Polaris skeleton page source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/components/feedback-indicators/skeleton-page.mdx)).
- Create action label is verb + noun ("Создать продукт")
  ([Polaris empty state source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/components/layout-and-structure/empty-state.mdx)).

### Bulk actions

- Only for operations frequently done on many records
  ([index table source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/components/tables/index-table.mdx)).
- Bar appears on first selection, replaces search/filters, shows "2 из 30 выбрано"; tri-state
  header checkbox; row actions disabled while active; Cancel exits
  ([Carbon data table](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines),
  [Polaris composition](https://shopify.dev/docs/api/app-home/patterns/compositions/index-table)).
- Destructive bulk action uses critical tone, modal confirm, toast on completion (same Polaris source).
- Polaris allows hiding bulk actions below ~490 px.

## 3. Resource detail pages (Person card, Product page)

### Header and layout

- One primary action, at most three secondary actions in the header; destructive action
  (Delete) sits in secondary with critical tone; no actions at the page bottom
  ([Polaris page](https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/page.md)).
- A page-level banner slot between header and sections suits "Доступ отозван" (same source).
- Primer PageHeader: context bar (back), title, trailing status visual kept visible at any width,
  actions collapse to overflow on narrow screens, optional underline nav
  ([Primer PageHeader](https://primer.style/product/components/page-header/guidelines/)).
- Two columns: main (about two thirds) plus secondary aside for status and metadata; aside stacks
  on mobile ([Polaris resource details layout](https://polaris.shopify.com/patterns/resource-details-layout), *unverified*;
  aside behaviour confirmed in [Polaris page](https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/page.md)).
- Shopify customer page: orders, timeline, notes, tags; sent emails appear in the timeline
  ([Manage customers](https://help.shopify.com/en/manual/customers/manage-customers)).
- Stripe customer page groups payments, payment methods, invoices; delete lives under an
  "Actions" menu ([Stripe customers](https://docs.stripe.com/billing/customer)).

### Tabs vs sections

- Tabs only for long content with clear groups; otherwise one page with subheadings; do not split
  data the user must compare ([NN/g tabs](https://www.nngroup.com/articles/tabs-used-right/),
  [Atlassian tabs](https://atlassian.design/components/tabs/usage)).
- Key info stays above the tabs; each tab has its own URL; at most two tab levels
  ([Primer UnderlineNav](https://primer.style/product/components/underline-nav/guidelines/)).
- Avoid accordions when most content is needed
  ([NN/g accordions](https://www.nngroup.com/articles/accordions-complex-content/)).
- Inference for the Person card: one page, sections in order Access (current state per product +
  actions), History (timeline), Payments, Submissions. Tabs only if Payments/Submissions become long.

### History timeline

- Primer Timeline: vertical items with coloured badge icons; status must be in text, not only
  colour; `condensed` variant for dense lists ([Primer Timeline](https://primer.style/components/timeline)).
- Store Product Access history in Inside: provider event logs are short-lived (Stripe events are
  retrievable for 30 days) ([Stripe events API](https://docs.stripe.com/api/events)).
- Inference: each event shows human date ("24 окт. 2026, 14:05"), actor (owner, payment,
  system), action, product, reason; link to the payment where relevant.

### Destructive actions (revoke access, deactivate link, delete)

- Confirm only consequential actions; overused confirmations stop being read; buttons name the
  outcome, not "Да/Нет" ([NN/g confirmation](https://www.nngroup.com/articles/confirmation-dialog/)).
- "Prefer reversibility over confirmation"; friction proportional to cost: no dialog for reversible
  actions, simple dialog for one resource, typed confirmation only for irreversible wide-scope
  actions ([Primer delete](https://primer.style/product/scenario-patterns/delete/)).
- Confirmation dialog: short question title, consequence in body, focus defaults to Cancel when
  the confirm button is dangerous; on failure keep the dialog open with an error banner
  ([Primer ConfirmationDialog](https://primer.style/product/components/confirmation-dialog/guidelines/)).
- Danger styling on both title and primary button; do not rely on colour alone
  ([Atlassian modal](https://atlassian.design/components/modal-dialog/usage)).
- Reason field model: Stripe refunds require choosing a reason, note mandatory for "Other"
  ([Stripe refunds](https://docs.stripe.com/refunds)).
- Stripe mobile deactivates a payment link without a dialog and offers Activate immediately
  ([Stripe mobile](https://docs.stripe.com/dashboard/mobile)).
- Inference: revoke = dialog with reason select (+ note for "Другое") and explicit consequence
  ("Ученик потеряет доступ к 12 материалам"); restore = one click with toast, since it is reversible.

### Raw IDs

- Show human labels; put the ID secondary with an always-visible copy button that turns into a
  check for about 2 s ([Primer copy](https://primer.style/product/scenario-patterns/copy/)).

## 4. Forms

- Validate on submit by default; after a field has errored, revalidate as the user types; never
  show errors before the user finishes the field
  ([Primer forms](https://primer.style/product/ui-patterns/forms/),
  [NN/g form errors](https://www.nngroup.com/articles/errors-forms-design-guidelines/),
  [Baymard inline validation](https://baymard.com/blog/inline-form-validation)).
- Server always validates; keep entered values; specific messages ("Введите сумму", "Сумма скидки
  не может превышать цену"), no "invalid"
  ([GOV.UK validation](https://design-system.service.gov.uk/patterns/validation/),
  [GOV.UK error message](https://design-system.service.gov.uk/components/error-message/)).
- Error summary at top when 3+ errors, linking to fields; otherwise focus the first invalid field
  ([Primer forms](https://primer.style/product/ui-patterns/forms/),
  [GOV.UK error summary](https://design-system.service.gov.uk/components/error-summary/)).
  Primer discourages disabled submit buttons.
- Dates: allow typing as well as a calendar; accept any separator and missing leading zeros
  ([NN/g date input](https://www.nngroup.com/articles/date-input/)). Put the format in the label
  or hint, not only in the placeholder ([Carbon date picker](https://carbondesignsystem.com/components/date-picker/usage/)).
  Presets ("Сегодня", "7 дней") help ([Polaris date picker](https://shopify.dev/docs/api/app-home/latest/web-components/forms/date-picker.md)).
- `<input type="date">` display depends on browser locale while the value is always `yyyy-mm-dd`
  ([MDN date input](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/date)).
  ISO strings are transport format only. `Intl.DateTimeFormat('ru-RU')` gives `24.10.2026`;
  `dateStyle: 'long'` gives "24 октября 2026 г." (verified locally in Node 24).
- Validity windows (discounts, links): set the time zone explicitly; the same instant renders as
  different days in different zones
  ([MDN DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat)).
- Money: `Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'RUB'})` gives "1 234 567,50 ₽"
  with U+00A0 separators; `trailingZeroDisplay: 'stripIfInteger'` gives "4 990 ₽"
  ([MDN NumberFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat);
  ru-RU output verified locally). Store integer kopecks; label by meaning ("Сумма скидки"); min/max
  bounds; currency symbol not in the label or placeholder
  ([Polaris money field](https://shopify.dev/docs/api/app-home/latest/web-components/forms/money-field.md)).
  Use a ₽ suffix outside the field plus the unit in the label for screen readers; accept a typed
  symbol; `inputmode="decimal"` ([GOV.UK text input](https://design-system.service.gov.uk/components/text-input/)).
- Discount model reference: percent or fixed amount, max redemptions, promo code as a wrapper over
  the discount, expiry blocks new uses only ([Stripe coupons](https://docs.stripe.com/billing/subscriptions/coupons)).
- Choosing a person or product: searchable combobox / select panel, not a long `<select>`
  ([GOV.UK select](https://design-system.service.gov.uk/components/select/),
  [Primer SelectPanel](https://primer.style/product/components/select-panel/guidelines/),
  [NN/g dropdowns](https://www.nngroup.com/articles/drop-down-menus/)).

## 5. Mobile admin

### Navigation

- Compact windows (< 600 dp) use a bottom navigation bar with 3-5 destinations; wider windows use
  a rail or sidebar ([Android adaptive navigation](https://developer.android.com/develop/ui/compose/layouts/adaptive/build-adaptive-navigation),
  [window size classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes),
  [Material bottom navigation](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomNavigation.md)).
- Apple tab bar: navigation only, always visible, one-word labels, five or fewer, avoid a "More"
  tab, badges only for critical info ([HIG tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)).
- Hidden navigation cut discoverability by more than 20% and slowed desktop tasks by at least 39%;
  combined visible + menu works best on mobile; icons need visible labels
  ([NN/g hamburger](https://www.nngroup.com/articles/hamburger-menus/),
  [NN/g mobile navigation](https://www.nngroup.com/articles/find-navigation-mobile-even-hamburger/),
  [NN/g icon usability](https://www.nngroup.com/articles/icon-usability/)).
- Shopify mobile hides rare sections under "…" ([Shopify app](https://help.shopify.com/en/manual/shopify-admin/shopify-app/using-the-shopify-app));
  Linear mobile is built around a bottom bar "for quick access to core workflows"
  ([Linear mobile](https://linear.app/changelog/2025-10-16-mobile-app-redesign)).
- The repo's earlier [mobile navigation research](2026-09-07-mobile-navigation-motion.md) covers
  motion; check it before choosing transitions.

### What the phone is for

- Stripe app: metrics, payment and customer lists, push for new payments and daily summary,
  global search, refund and payment link actions from a bottom action bar, "+" for create; some
  tasks explicitly web-only ([Stripe mobile](https://docs.stripe.com/dashboard/mobile)).
- Shopify app: view metrics, process orders, update catalogue, notifications
  ([Shopify app](https://help.shopify.com/en/manual/shopify-admin/shopify-app)).
- Polaris density: tables and lists dense; focused editing less dense with larger targets
  ([Polaris density source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/design/layout/density.mdx)).
- Inference: mobile-first tasks are check sales, find a person, grant/revoke/restore access,
  review a submission, deactivate a link. Keep long material editing, bulk operations and the wide
  funnel comparison desktop-first with a calm "удобнее на компьютере" note, while still reachable.

### Tables on phones

- Design the desktop table first, then pick attributes for mobile; landscape is a last resort;
  if horizontal scroll remains, freeze the name column and show a cut-off column as a cue
  ([NN/g mobile tables](https://www.nngroup.com/articles/mobile-tables/)).
- Polaris tables become lists on narrow screens: primary column becomes the item title, status the
  secondary slot; data reads as key/value pairs
  ([Polaris table](https://shopify.dev/docs/api/app-home/polaris-web-components/layout-and-structure/table)).

### Touch targets

- WCAG 2.2 AA minimum 24x24 CSS px with spacing exceptions; 44 px is AAA
  ([WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)).
- Apple default 44x44 pt ([HIG accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility));
  Android 48x48 dp ([Android accessibility](https://developer.android.com/guide/topics/ui/accessibility/apps));
  NN/g about 1x1 cm with ~2 mm gaps ([touch targets](https://www.nngroup.com/articles/touch-target-size/)).

## 6. Dashboard charts

- Bars and lines read at a glance; avoid pie/donut and gauges in most cases; line beats bar for
  trends; avoid stacked bars ([NN/g preattentive](https://www.nngroup.com/articles/dashboards-preattentive/),
  [NN/g chart types](https://www.nngroup.com/articles/choosing-chart-types/)).
- Polaris: one chart answers one question; column chart under 30 points, line above; test with
  1-2 points, 100+ points, sparse (mostly zero) and spiky data
  ([Polaris data viz, archived](https://web.archive.org/web/20231222020526id_/https://polaris.shopify.com/design/data-visualizations)).
- Comparison: current period solid, previous dotted or faded
  ([Shopify time ranges](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/using-reports/time-ranges));
  default compare to the preceding period of the same length
  ([Stripe payments analytics](https://docs.stripe.com/payments/analytics/acceptance.md));
  "today" compared with the 7-day daily average, not with a full yesterday
  ([Shopify order analytics](https://help.shopify.com/en/manual/fulfillment/managing-orders/analytics/order-analytics)).
- Direction matters: rising refunds are bad (Power BI "high is good" setting,
  [KPI visual](https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-kpi)).
- Low volume (inference from Shopify's 10-orders/week and Gumroad's 7-days thresholds): show
  absolute deltas ("+2 продажи") instead of percentages on tiny bases; "нет данных за прошлый
  период" instead of "+∞%"; prefer one large chart over per-KPI sparklines, which will be flat or
  spiky. Primer no longer adds new sparklines
  ([Primer data viz](https://primer.style/product/ui-patterns/data-visualization/));
  a sparkline is word-sized and pairs with its number
  ([Tufte](https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/)).
- Accessible colour: chart marks 3:1 against background, text 4.5:1; never colour alone, use line
  style, shapes, direct labels; at most 5-6 series colours; gaps between adjacent areas
  ([Primer data viz](https://primer.style/product/ui-patterns/data-visualization/),
  [Atlassian data viz colour](https://atlassian.design/foundations/color/data-visualization-color),
  [WCAG 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html),
  [WCAG 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)).
- Provide the data as a table nearby; `aria-hidden` the SVG with a text equivalent
  ([Polaris data viz, archived](https://web.archive.org/web/20231222020526id_/https://polaris.shopify.com/design/data-visualizations)).
- Axis labels: abbreviated numbers, short dates ("10 окт"), skip labels instead of rotating
  (same Polaris source).
- Empty chart: say what will appear and how to make it appear, link to the action
  ([NN/g empty states](https://www.nngroup.com/articles/empty-state-interface-design/)).
- Chart colour, axis and interaction rules are a separate design decision; this note does not prescribe tooling.

## 7. Visual polish

- Hierarchy through colour and weight, not only size: 2-3 text colours, two weights; no grey text
  on coloured backgrounds; fewer borders (use spacing, background shifts, shadows); one solid
  primary, secondary outline, tertiary link-style
  ([Refactoring UI tips, archived](https://medium.com/refactoring-ui/7-practical-tips-for-cheating-at-design-40c736799886)).
- "Labels are a last resort": fold labels into values ("12 материалов"), de-emphasise labels when
  needed ([Refactoring UI, archived](https://www.refactoringui.com/previews/labels-are-a-last-resort)).
- Avoid card-everything: do not wrap a table in a card that holds nothing else; dividers only in
  data tables; separate dense zones by background, not lines; nested surfaces get smaller radius
  ([Polaris spatial organization source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/design/layout/spacial-organization.mdx),
  [Polaris density source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/design/layout/density.mdx)).
- Linear 2026: "structure should be felt not seen"; dimmer sidebar, fewer and smaller icons, no
  coloured icon backgrounds ([Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh)).
- Spacing on a 4 px base: Polaris 4, 8, 12, 16, 20, 24, 32, 40, 48, 64; card padding and gap 16
  ([Polaris space tokens](https://github.com/Shopify/polaris/blob/main/polaris-tokens/src/themes/base/space.ts));
  Carbon: closeness signals relation, step down the scale on small screens
  ([Carbon spacing](https://carbondesignsystem.com/elements/spacing/overview/)).
- Type: productive (compact) set for product UI ([Carbon typography](https://carbondesignsystem.com/elements/typography/overview/));
  headings need not be larger than content, weight can carry hierarchy
  ([Polaris using type source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/design/typography/using-type.mdx));
  14 px is the default label/body size in Geist ([Geist typography](https://vercel.com/geist/typography)).
- Colour steps: Geist assigns 100-300 to component backgrounds, 400-600 borders, 900-1000 text
  ([Geist colours](https://vercel.com/geist/colors)); radii 6 / 12 px
  ([Geist materials](https://vercel.com/geist/materials)).
- Status chips: short, past tense ("Оплачен", "Возвращён", "Отозван"); same status, same tone
  everywhere; warning/critical sparingly; not interactive; not colour-only; categories use tags,
  statuses use lozenges ([Polaris badge source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/components/feedback-indicators/badge.mdx),
  [Atlassian lozenge](https://atlassian.design/components/lozenge/usage),
  [Primer Label](https://primer.style/product/components/label/)).
- Nav icons with always-visible labels; counters only for actionable queues (badges for critical
  info only) ([NN/g indicators](https://www.nngroup.com/articles/indicators-validations-notifications/),
  [HIG tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)).
- One high-emphasis button per screen; red only for hard-to-undo actions
  ([Carbon button](https://carbondesignsystem.com/components/button/usage/),
  [Polaris button source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/components/actions/button.mdx)).

## Recommendations for this platform

1. Overview = period selector, 3-4 KPIs (Выручка нетто, Продажи, Новые ученики, Возвраты) with
   period and delta, a "Требует внимания" list, one revenue/sales chart, recent activity.
2. Show absolute deltas on small bases and "нет данных" for empty previous periods; colour deltas
   by meaning (more refunds = bad) and pair colour with an arrow or sign.
3. "Требует внимания" rows link to pre-filtered lists (submissions to review, failed/pending
   payments, links expiring) and collapse to a single "Всё в порядке" when empty.
4. Before the first sale, replace charts with a setup checklist.
5. Skip per-KPI sparklines; one chart, switchable by KPI, current period solid, previous dashed.
6. All index pages share one skeleton: title + count, primary create button, saved-view tabs,
   search, 2-3 promoted filters, pills with "Сбросить", table, pagination of 20-50 rows.
7. Rows: name + secondary line first, status chip second, 4-6 columns, right-aligned tabular
   numbers, whole row opens the detail page, at most one inline action plus an always-visible "⋯".
8. Keep filters and search in the URL; distinct empty, no-results and error states.
9. Bulk actions only where they repeat in practice (Submissions, maybe People); bar replaces
   the filter row and shows "N выбрано".
10. Person card: header with name, contact, status chip and one primary action; sections Access
    (per product current state with Выдать/Отозвать/Восстановить), History timeline, Payments,
    Submissions; IDs secondary with copy.
11. Revoke = dialog with reason (select + required note for "Другое") and named consequence;
    restore and link reactivation = immediate with toast, since reversible.
12. History events show human time, actor, action, product, reason; stored in Inside, not
    derived from provider logs.
13. Format every date and amount through shared `ru-RU` `Intl` helpers with an explicit time
    zone; never render ISO strings or raw kopecks.
14. Money inputs: ₽ suffix, unit in label, integer kopecks, bounded, specific error text; date
    inputs accept typing plus calendar with presets.
15. Validate on submit, then live after first error; keep values; error summary for 3+ errors.
16. Mobile: bottom bar with five labelled sections (Обзор, Контент, Ученики, Продажи, Сообщения
    if enabled), subsections as top tabs; desktop: visible sidebar with icons, labels, counters
    only for Submissions to review.
17. Mobile tables become lists (title, status, one key number); sticky bottom action bar on
    detail pages; 44 px targets; funnel comparison and bulk editing desktop-first.
18. Fewer cards and borders: tables sit on the page surface; cards only for real context changes;
    one dark primary button per view; orange for focus/accent, not for every badge.
19. Status chips: one shared map from domain status to label and tone, past tense, text plus tone.
20. Validate the design in Storybook with real Russian lengths, empty data, one sale, and 1000 rows.

## Best references to look at

1. [Shopify Home](https://help.shopify.com/en/manual/shopify-admin/shopify-home): KPI tabs over one chart, grouped task counts, setup checklist.
2. [Polaris index table composition](https://shopify.dev/docs/api/app-home/patterns/compositions/index-table): primary column, status, bulk bar, mobile list slot.
3. [Polaris IndexFilters source](https://github.com/Shopify/polaris/blob/main/polaris.shopify.com/content/components/selection-and-input/index-filters.mdx): saved views, pills, sort.
4. [Carbon data table guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines): density, row actions, batch actions.
5. [Carbon empty states](https://www.carbondesignsystem.com/patterns/empty-states-pattern/): three empty-state types.
6. [Primer delete pattern](https://primer.style/product/scenario-patterns/delete/): reversibility over confirmation.
7. [Primer filter pattern](https://primer.style/product/scenario-patterns/filter/): URL state, no-results, revert.
8. [Stripe Dashboard mobile](https://docs.stripe.com/dashboard/mobile): what a payments admin does on a phone.
9. [Kajabi creator mobile app](https://help.kajabi.com/en/articles/17175659-explore-the-kajabi-creator-mobile-app): creator KPIs in priority order.
10. [NN/g data tables](https://www.nngroup.com/articles/data-tables/) and [mobile tables](https://www.nngroup.com/articles/mobile-tables/).
11. [Polaris data visualization (archived)](https://web.archive.org/web/20231222020526id_/https://polaris.shopify.com/design/data-visualizations): metrics, comparison, axis labels.
12. [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh): calm structure, dimmer navigation.
