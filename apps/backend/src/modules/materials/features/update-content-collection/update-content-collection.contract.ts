import type {
  ContentCollectionNotFoundError,
  ForbiddenError,
  InvalidContentError,
  StaleContentCollectionVersionError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";
import type {
  ContentCollectionDto,
  ContentCollectionKind,
} from "../../facets/material-authoring/content-collection.contract.js";

export interface UpdateContentCollectionCommand {
  readonly actor: string;
  readonly collectionId: string;
  readonly expectedVersion: number;
  readonly kind: ContentCollectionKind;
  readonly name: string;
  readonly summary: string;
}

export type UpdateContentCollectionError =
  | ContentCollectionNotFoundError
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
