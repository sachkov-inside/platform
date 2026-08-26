import type {
  MaterialId,
  MaterialRevisionId,
} from "../../../../src/modules/materials/domain/material-identifiers.js";
import type {
  AccountsPrisma,
  MaterialsPrismaClient,
} from "../../../../src/infrastructure/prisma/index.js";
declare const revisionId: MaterialRevisionId;
declare function materialsTable(table: "materials.materials"): void;
declare const accountsPrisma: AccountsPrisma;
declare const materialsPrisma: MaterialsPrismaClient;

const materialId: MaterialId = revisionId;
materialsTable("accounts.accounts");
await materialsPrisma.$transaction(async (transaction) =>
  transaction.account.count(),
);
await accountsPrisma.material.count();

describe("production code", () => materialId);
