import type { PlatformDatabase } from "../../../../infrastructure/postgres/index.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import type { ContentAccess } from "../ports/content-access.js";
import { listPublishedMaterialProjections } from "./list-published-material-projections.js";
import type {
  ListPublishedMaterialProjectionsQuery,
  PublishedMaterialReader,
  ReadPublishedMaterialQuery,
} from "./published-material-reader.js";
import { readPublishedMaterial } from "./read-published-material.js";

export function createPublishedMaterialReader(dependencies: {
  readonly database: PlatformDatabase;
  readonly contentAccess: ContentAccess;
  readonly materialBodyOperations: MaterialBodyOperations;
}): PublishedMaterialReader {
  return Object.freeze({
    listProjections: (query: ListPublishedMaterialProjectionsQuery) =>
      listPublishedMaterialProjections(dependencies.database, query),
    read: (query: ReadPublishedMaterialQuery) =>
      readPublishedMaterial(dependencies, query),
  });
}
