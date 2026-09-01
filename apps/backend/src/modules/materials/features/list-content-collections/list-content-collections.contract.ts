import type {
  ForbiddenError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";
import type {
  ContentCollectionDto,
  ContentCollectionKind,
} from "../../facets/material-authoring/content-collection.contract.js";

export type {
  ContentCollectionDto,
  ContentCollectionKind,
} from "../../facets/material-authoring/content-collection.contract.js";

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
