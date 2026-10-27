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

/** One row of the authoring list: the collection and how many people hold it now. */
export interface ContentCollectionListItemDto extends ContentCollectionDto {
  /**
   * Accounts whose Product Access is active now, a count without personal data. `null` means the
   * count is not available here: the actor lacks `billing:manage` (the right of Product holder
   * reads), the collection is a Topic, or the Product Access owner did not answer. Never a
   * stand-in 0.
   */
  readonly holderCount: number | null;
}

export type ListContentCollectionsResult = Result<
  readonly ContentCollectionListItemDto[],
  ForbiddenError | SystemError
>;

export type ListContentCollectionsOperation = (
  query: ListContentCollectionsQuery,
) => Promise<ListContentCollectionsResult>;
