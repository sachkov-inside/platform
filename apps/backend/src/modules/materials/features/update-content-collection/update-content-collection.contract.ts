import type {
  ContentCollectionNotFoundError,
  ContentCollectionSlugConflictError,
  ForbiddenError,
  InvalidContentError,
  StaleContentCollectionVersionError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";
import type { GuideSourceFields } from "../../infrastructure/postgres/content-collection-persistence.js";
import type {
  ContentCollectionDto,
  ContentCollectionKind,
  GuideIntroductionDto,
} from "../../facets/material-authoring/content-collection.contract.js";

export interface UpdateContentCollectionCommand {
  readonly actor: string;
  readonly collectionId: string;
  readonly expectedVersion: number;
  /** Omitted preserves the stored introduction; supplied replaces all of it. */
  readonly introduction?: GuideIntroductionDto;
  readonly kind: ContentCollectionKind;
  readonly name: string;
  /** Только для source-scoped импорта Guide (ADR 0026). */
  readonly source?: GuideSourceFields;
  readonly summary: string;
}

export type UpdateContentCollectionError =
  | ContentCollectionNotFoundError
  | ContentCollectionSlugConflictError
  | ForbiddenError
  | InvalidContentError
  | StaleContentCollectionVersionError
  | SystemError;

export type UpdateContentCollectionResult = Result<
  ContentCollectionDto,
  UpdateContentCollectionError
>;

export type UpdateContentCollectionOperation = (
  command: UpdateContentCollectionCommand,
) => Promise<UpdateContentCollectionResult>;
