import type {
  ContentCollectionNotFoundError,
  ContentCollectionSlugConflictError,
  ForbiddenError,
  InvalidContentError,
  InvalidReferenceError,
  StaleContentCollectionVersionError,
  SystemError,
} from "../../../../infrastructure/content-authoring/authoring-errors.js";
import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import type { ProductSourceFields } from "../../domain/product-page.js";
import type {
  ContentCollectionDto,
  ContentCollectionKind,
  ProductIntroductionDto,
} from "../../facets/product-authoring/content-collection.contract.js";

export interface UpdateContentCollectionCommand {
  readonly actor: string;
  readonly collectionId: string;
  readonly expectedVersion: number;
  /** Omitted preserves the stored introduction; supplied replaces all of it. */
  readonly introduction?: ProductIntroductionDto | undefined;
  readonly kind: ContentCollectionKind;
  readonly name: string;
  /** Только для source-scoped импорта Product (ADR 0026). */
  readonly source?: ProductSourceFields;
  readonly summary: string;
}

export type UpdateContentCollectionError =
  | ContentCollectionNotFoundError
  | ContentCollectionSlugConflictError
  | ForbiddenError
  | InvalidContentError
  | InvalidReferenceError
  | StaleContentCollectionVersionError
  | SystemError;

export type UpdateContentCollectionResult = Result<
  ContentCollectionDto,
  UpdateContentCollectionError
>;

export type UpdateContentCollectionOperation = (
  command: UpdateContentCollectionCommand,
) => Promise<UpdateContentCollectionResult>;
