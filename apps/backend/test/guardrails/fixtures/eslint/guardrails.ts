/* eslint-disable no-restricted-imports, @typescript-eslint/switch-exhaustiveness-check */
import type { Kysely } from "kysely";

import type { CreateDraftError } from "../../../../src/modules/materials/index.js";
import type { MaterialId } from "../../../../src/modules/materials/domain/material-identifiers.js";

export type ForbiddenDirectImport = MaterialId;
export type ForbiddenPersistenceImport = Kysely<unknown>;

export function incompleteErrorMapping(error: CreateDraftError): number {
  switch (error.code) {
    case "forbidden":
      return 403;
  }
  return 500;
}
