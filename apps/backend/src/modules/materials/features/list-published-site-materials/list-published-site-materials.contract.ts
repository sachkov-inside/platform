import type { Result } from "../../result.js";
import type { PublishedMaterialProjectionListError } from "../list-published-material-projections/list-published-material-projections.contract.js";

export interface PublishedSiteMaterialCursor {
  readonly materialId: string;
  readonly publishedAt: string;
}
export interface PublishedSiteMaterialsQuery {
  readonly first: number;
  readonly after?: PublishedSiteMaterialCursor;
}
export interface PublishedSiteMaterialsPage {
  readonly items: readonly {
    readonly slug: string;
    readonly publishedAt: string;
  }[];
  readonly productSlugs: readonly string[];
  readonly topicSlugs: readonly string[];
  readonly continuation: PublishedSiteMaterialCursor | null;
}
export type ListPublishedSiteMaterialsOperation = (
  query: PublishedSiteMaterialsQuery,
) => Promise<
  Result<PublishedSiteMaterialsPage, PublishedMaterialProjectionListError>
>;
