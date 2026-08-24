import type {
  MaterialId,
  MaterialRevisionId,
} from "../../../../src/modules/materials/domain/material-identifiers.js";

declare const revisionId: MaterialRevisionId;

const materialId: MaterialId = revisionId;

describe("production code", () => materialId);
