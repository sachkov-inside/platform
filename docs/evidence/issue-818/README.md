# Evidence: survey respondents in the sales funnel report (#818)

Captured from Storybook for the production module
`apps/web/src/_pages/sales-funnel-report/ui/sales-funnel-report-view.tsx`, stories
`Pages/Authoring/Sales funnel report`. Each capture asserted no horizontal overflow of the document
or the report. The figures are fixture aggregates; no username appears in the report.

| State | 390 | 1440 |
|---|---|---|
| Survey list uploaded: uploaded, issued, bought, share | [ready-390.png](ready-390.png) | [ready-1440.png](ready-1440.png) |
| Survey list not uploaded yet: the share is unavailable | [survey-list-missing-390.png](survey-list-missing-390.png) | [survey-list-missing-1440.png](survey-list-missing-1440.png) |

Visual acceptance of the page remains #819.
