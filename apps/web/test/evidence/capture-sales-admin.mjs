// @ts-check
/// <reference lib="dom" />
/**
 * Production visual gate #1718 in Storybook: the product page tabs and the «Продажи» section at 390
 * and 1440 px. Run after `pnpm build:storybook`; `UPDATE_EVIDENCE=issue-1718` writes into
 * `docs/evidence/issue-1718`. The checks and capture live in
 * `storybook-evidence.mjs`.
 */
import { captureStorybookEvidence } from "./storybook-evidence.mjs";

/** @type {import("./storybook-evidence.mjs").StoryFamilies} */
const families = [
  [
    "pages-authoring-product-editor",
    "Pages/Authoring/Редактор продукта",
    [
      ["SaleTabDesktop", "SaleTabMobile"],
      ["LearnersTabDesktop", "LearnersTabMobile"],
      ["CommunityTabDesktop", "CommunityTabMobile"],
    ],
  ],
  [
    "features-product-sale",
    "Features/Product/Продажа продукта",
    [
      ["UnpricedDesktop", "UnpricedMobile"],
      ["ClosedDesktop", "ClosedMobile"],
      ["RunningDesktop", "RunningMobile"],
      ["PriceArchivedDesktop", "PriceArchivedMobile"],
      ["UnavailableDesktop", "UnavailableMobile"],
      ["ForbiddenDesktop", "ForbiddenMobile"],
    ],
  ],
  [
    "features-product-community",
    "Features/Product/Сообщество и активация",
    [
      ["RulesDesktop", "RulesMobile"],
      ["EmptyDesktop", "EmptyMobile"],
      ["UnavailableDesktop", "UnavailableMobile"],
    ],
  ],
  [
    "pages-authoring-product-learners",
    "Pages/Authoring/Продукт/Ученики",
    [
      ["OneLearnerDesktop", "OneLearnerMobile"],
      ["LongListDesktop", "LongListMobile"],
      ["EmptyDesktop", "EmptyMobile"],
      ["RefusedDesktop", "RefusedMobile"],
      ["ErrorDesktop", "ErrorMobile"],
    ],
  ],
  [
    "pages-authoring-product-grant",
    "Pages/Authoring/Продукт/Выдать продукт",
    [
      ["SelectionDesktop", "SelectionMobile"],
      ["PartialFailureDesktop", "PartialFailureMobile"],
    ],
  ],
  [
    "pages-authoring-products",
    "Pages/Authoring/Продукты",
    [
      ["ProductsDesktop", "ProductsMobile"],
      ["LongList", "LongListMobile"],
      ["Empty", "EmptyMobile"],
      ["SaleWithoutOwnerPrices", "SaleWithoutOwnerPricesMobile"],
    ],
  ],
  [
    "pages-authoring-payments",
    "Pages/Authoring/Платежи",
    [
      ["OneSale", "OneSaleMobile"],
      ["LongList", "LongListMobile"],
      ["Empty", "EmptyMobile"],
      ["FilteredNoResults", "FilteredNoResultsMobile"],
      ["Unavailable", "UnavailableMobile"],
      ["Forbidden", "Forbidden"],
    ],
  ],
  [
    "pages-authoring-payment",
    "Pages/Authoring/Платёж",
    [
      ["WithRefunds", "WithRefundsMobile"],
      ["UnknownState", "UnknownStateMobile"],
      ["NotFound", "NotFound"],
      [null, "Unavailable"],
    ],
  ],
  [
    "pages-authoring-payment-order-email",
    "Pages/Authoring/Платёж/Email заказа",
    [
      ["Hidden", "HiddenMobile"],
      ["Shown", "ShownMobile"],
      ["Forbidden", "Forbidden"],
    ],
  ],
  [
    "pages-authoring-sales-payment-links",
    "Pages/Authoring/Sales/Payment links",
    [
      ["EmptyDesktop", "EmptyMobile"],
      ["OneLinkDesktop", "OneLinkMobile"],
      ["LongListDesktop", "LongListMobile"],
      ["LinkDetailsDesktop", "LinkDetailsMobile"],
      ["RefusedDesktop", "RefusedMobile"],
      ["Unavailable", "Unavailable"],
    ],
  ],
  [
    "components-admin-sales-payment-link-create",
    "Components/Админка/Продажи/Создание ссылки на оплату",
    [
      ["ProductPriceDesktop", "ProductPriceMobile"],
      ["DiscountDesktop", "DiscountMobile"],
      ["CreatedDesktop", "CreatedMobile"],
      ["ProductsUnavailable", "ProductsUnavailable"],
    ],
  ],
  [
    "pages-authoring-sales-discounts",
    "Pages/Authoring/Sales/Discounts",
    [
      ["EmptyDesktop", "EmptyMobile"],
      ["ListDesktop", "ListMobile"],
      ["ArchiveDesktop", "ArchiveMobile"],
      ["QuestionnaireDesktop", "QuestionnaireMobile"],
      ["RefusedDesktop", "RefusedMobile"],
      ["Unavailable", "Unavailable"],
    ],
  ],
  [
    "components-admin-sales-promotion-form",
    "Components/Админка/Продажи/Форма скидки",
    [
      ["CreateDesktop", "CreateMobile"],
      ["EditDesktop", "EditMobile"],
      ["RevisionConflict", "RevisionConflict"],
    ],
  ],
  [
    "pages-authoring-sales-funnel",
    "Pages/Authoring/Sales funnel report",
    [
      ["Ready", "ReadyMobile"],
      ["EmptyPeriod", "EmptyPeriod"],
      ["Forbidden", "Forbidden"],
      ["Unavailable", "Unavailable"],
    ],
  ],
  [
    "components-admin-confirm-dialog",
    "Components/Админка/AdminConfirmDialog",
    [
      ["DangerDesktop", "DangerMobile"],
      ["WithError", "WithError"],
    ],
  ],
  [
    "components-admin-search-select",
    "Components/Админка/Выбор из длинного списка",
    [["BoundedDesktop", "BoundedMobile"]],
  ],
];

await captureStorybookEvidence({ issue: "issue-1718", families });
