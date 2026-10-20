import { assembleAccountRights } from "../../src/modules/account-rights/index.js";
import { SalesFunnel } from "../../src/modules/sales-funnel/facets/sales-funnel/sales-funnel.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { ProductOutlines } from "../../src/modules/materials/index.js";
import { MaterialFirstOpens } from "../../src/modules/reading-activity/index.js";
import {
  BillingProductSales,
  BillingSurveyRespondentSales,
} from "../../src/modules/billing/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import type { PlatformPrisma } from "../../src/infrastructure/prisma/index.js";

export function assembleTestFunnel(prisma: PlatformPrisma) {
  return new SalesFunnel({
    prisma,
    rights: assembleAccountRights({
      prisma,
      clock: () => new Date("2026-10-19T12:00:00Z"),
    }),
    accounts: assembleAccounts({
      prisma,
      emailFingerprintKey: "synthetic-funnel-diagnostic-fingerprint",
    }),
    outlines: new ProductOutlines(prisma),
    firstOpens: new MaterialFirstOpens(prisma),
    sales: new BillingProductSales(prisma),
    surveyRespondents: new BillingSurveyRespondentSales(prisma),
    links: new TelegramAccountLinks(prisma),
    clock: () => new Date("2026-10-19T12:00:00Z"),
  });
}
