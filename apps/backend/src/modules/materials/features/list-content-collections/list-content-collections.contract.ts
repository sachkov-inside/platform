import type {
  ForbiddenError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export type ContentCollectionKind = "series" | "topic";

export interface ContentCollectionDto {
  readonly archived: boolean;
  readonly id: string;
  readonly kind: ContentCollectionKind;
  readonly materialCount: number;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
  readonly version: number;
}

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
