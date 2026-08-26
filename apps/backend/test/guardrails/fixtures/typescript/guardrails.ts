import type {
  MaterialId,
  MaterialRevisionId,
} from "../../../../src/modules/materials/domain/material-identifiers.js";
import type {
  IdentityPrincipalsPrisma,
  MaterialsPrismaClient,
} from "../../../../src/infrastructure/prisma/index.js";
declare const revisionId: MaterialRevisionId;
declare function materialsTable(table: "materials.materials"): void;
declare const identityPrisma: IdentityPrincipalsPrisma;
declare const materialsPrisma: MaterialsPrismaClient;

const materialId: MaterialId = revisionId;
materialsTable("identity_principals.principals");
await materialsPrisma.$transaction(async (transaction) =>
  transaction.identityPrincipal.count(),
);
await identityPrisma.material.count();

describe("production code", () => materialId);
