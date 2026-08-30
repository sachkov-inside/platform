import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { listPublishedMaterialProjections } from "../../features/list-published-material-projections/list-published-material-projections.js";
import type { ListPublishedMaterialProjectionsQuery } from "../../features/list-published-material-projections/list-published-material-projections.contract.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import type { ContentAccess } from "../../../content-access/index.js";
import type { MaterialContent } from "../material-content/material-content.js";
import type { PublishedMaterialReader } from "./published-material-reader.js";
import { readPublishedMaterial } from "../../features/read-published-material/read-published-material.js";
import type { ReadPublishedMaterialQuery } from "../../features/read-published-material/read-published-material.contract.js";
import { discoverPublishedMaterialProjections } from "../../features/discover-published-material-projections/discover-published-material-projections.js";
import type { DiscoverPublishedMaterialProjectionsQuery } from "../../features/discover-published-material-projections/discover-published-material-projections.contract.js";

export function assemblePublishedMaterialReader(dependencies: {
  readonly prisma: MaterialsPrismaClient;
  readonly contentAccess: ContentAccess;
  readonly materialContent: MaterialContent;
  readonly materialBodyOperations: MaterialBodyOperations;
  readonly membershipAcquisitionUrl: string;
}): PublishedMaterialReader {
  return Object.freeze({
    discoverProjections: (query: DiscoverPublishedMaterialProjectionsQuery) =>
      discoverPublishedMaterialProjections(dependencies.prisma, query),
    listProjections: (query: ListPublishedMaterialProjectionsQuery) =>
      listPublishedMaterialProjections(dependencies.prisma, query),
    read: (query: ReadPublishedMaterialQuery) =>
      readPublishedMaterial(dependencies, query),
  });
}
