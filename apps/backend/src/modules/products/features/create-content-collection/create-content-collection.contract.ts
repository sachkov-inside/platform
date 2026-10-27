import type {
  ContentCollectionSlugConflictError,
  ForbiddenError,
  InvalidContentError,
  SystemError,
} from "../../../../infrastructure/content-authoring/authoring-errors.js";
import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import type {
  ContentCollectionDto,
  ContentCollectionKind,
} from "../../facets/product-authoring/content-collection.contract.js";

export interface CreateContentCollectionCommand {
  readonly actor: string;
  readonly kind: ContentCollectionKind;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
}

export type CreateContentCollectionError =
  | ContentCollectionSlugConflictError
  | ForbiddenError
  | InvalidContentError
  | SystemError;

export type CreateContentCollectionResult = Result<
  ContentCollectionDto,
  CreateContentCollectionError
>;

export type CreateContentCollectionOperation = (
  command: CreateContentCollectionCommand,
) => Promise<CreateContentCollectionResult>;
