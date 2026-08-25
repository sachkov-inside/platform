import type {
  MaterialId,
  MaterialRevisionId,
} from "../../../../src/modules/materials/domain/material-identifiers.js";
import type { AuthoringDatabase } from "../../../../src/modules/materials/infrastructure/postgres/database.js";

declare const revisionId: MaterialRevisionId;
declare const materialsDatabase: AuthoringDatabase;

const materialId: MaterialId = revisionId;
materialsDatabase.selectFrom("identity_principals.principals");

describe("production code", () => materialId);
