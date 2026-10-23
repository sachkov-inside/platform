import type {
  ForbiddenError,
  SystemError,
} from "../../../../infrastructure/content-authoring/authoring-errors.js";
import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import type {
  ContentCollectionDto,
  ContentCollectionKind,
} from "../../facets/product-authoring/content-collection.contract.js";

export type {
  ContentCollectionDto,
  ContentCollectionKind,
} from "../../facets/product-authoring/content-collection.contract.js";

export interface ListContentCollectionsQuery {
  readonly actor: string;
  readonly kind: ContentCollectionKind;
}

export type ListContentCollectionsResult = Result<
  readonly ContentCollectionDto[],
  ForbiddenError | SystemError
>;

export type ListContentCollectionsOperation = (
  query: ListContentCollectionsQuery,
) => Promise<ListContentCollectionsResult>;
