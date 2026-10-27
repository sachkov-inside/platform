// @ts-check
/// <reference lib="dom" />
/**
 * Production visual gate #1719 in Storybook: the key page stories of the whole admin specification
 * #1717 (Overview, product Overview tab and editor tabs, people, person card, payments, Materials,
 * submissions) and the MetricCard and TrendChart modules at 390 and 1440 px. Run after
 * `pnpm build:storybook`; `UPDATE_EVIDENCE=issue-1719` writes into `docs/evidence/issue-1719`. The checks and capture live in
 * `storybook-evidence.mjs`.
 */
import { captureStorybookEvidence } from "./storybook-evidence.mjs";

/** @type {import("./storybook-evidence.mjs").StoryFamilies} */
const families = [
  [
    "pages-authoring-overview",
    "Pages/Authoring/Обзор",
    [
      ["Owner", "OwnerMobile"],
      ["EmptyPeriod", "EmptyPeriodMobile"],
      ["OneSale", "OneSaleMobile"],
      ["LongLists", "LongListsMobile"],
      ["MaterialsOnly", "MaterialsOnlyMobile"],
      ["Unavailable", "UnavailableMobile"],
      ["AllClear", "AllClearMobile"],
    ],
  ],
  [
    "pages-authoring-product-overview",
    "Pages/Authoring/Обзор продукта",
    [
      ["Ready", "ReadyMobile"],
      ["Empty", "EmptyMobile"],
      ["Unavailable", "UnavailableMobile"],
      ["MaterialsOnly", "MaterialsOnlyMobile"],
    ],
  ],
  [
    "pages-authoring-product-editor",
    "Pages/Authoring/Редактор продукта",
    [
      ["Desktop", "Mobile"],
      ["SaleTabDesktop", "SaleTabMobile"],
      ["LearnersTabDesktop", "LearnersTabMobile"],
    ],
  ],
  ["pages-authoring-people", "Pages/Authoring/Люди", [["Populated", "Mobile"]]],
  [
    "pages-authoring-person",
    "Pages/Authoring/Карточка человека",
    [["AllBlocks", "AllBlocksMobile"]],
  ],
  [
    "pages-authoring-payments",
    "Pages/Authoring/Платежи",
    [["OneSale", "OneSaleMobile"]],
  ],
  [
    "pages-authoring-materials",
    "Pages/Authoring/Материалы",
    [["Populated", "Mobile"]],
  ],
  [
    "pages-authoring-task-submissions",
    "Pages/Authoring/Task submissions",
    [["Submissions", "SubmissionsMobile"]],
  ],
  [
    "components-admin-metric-card",
    "Components/Админка/MetricCard",
    [
      ["OverviewRowDesktop", "OverviewRowMobile"],
      ["WithDetailDesktop", "UnavailableMobile"],
    ],
  ],
  [
    "components-admin-trend-chart",
    "Components/Админка/TrendChart",
    [
      ["ThirtyDaysDesktop", "ThirtyDaysMobile"],
      ["NegativeDayDesktop", "NegativeDayMobile"],
      ["EmptyDesktop", "EmptyMobile"],
    ],
  ],
];

await captureStorybookEvidence({ issue: "issue-1719", families });
