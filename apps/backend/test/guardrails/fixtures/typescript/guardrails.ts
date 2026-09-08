import type { MaterialId } from "../../../../src/modules/materials/domain/material-identifiers.js";
import type { AccountId } from "../../../../src/modules/accounts/domain/account-identifiers.js";
import type {
  AccountsPrisma,
  MaterialsPrismaClient,
} from "../../../../src/infrastructure/prisma/index.js";
declare const accountId: AccountId;
declare function materialsTable(table: "materials.materials"): void;
declare const accountsPrisma: AccountsPrisma;
declare const materialsPrisma: MaterialsPrismaClient;

const materialId: MaterialId = accountId;
materialsTable("accounts.accounts");
await materialsPrisma.$transaction(async (transaction) =>
  transaction.account.count(),
);
await accountsPrisma.material.count();

describe("production code", () => materialId);

import type { ReadingActivityPrismaClient } from "../../../../src/infrastructure/prisma/index.js";
declare const readingPrisma: ReadingActivityPrismaClient;
await readingPrisma.material.count();
await materialsPrisma.readingMaterialState.count();

// Billing contact persistence is owned by Accounts, never Materials.
declare const foreignBillingPrisma: import("../../../../src/infrastructure/prisma/index.js").MaterialsPrisma;
foreignBillingPrisma.billingContact.findMany();
foreignBillingPrisma.billingConsentEvidence.findMany();
