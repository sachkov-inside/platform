import type {
  ContentCollectionNotFoundError,
  ForbiddenError,
  InvalidContentError,
  InvalidReferenceError,
  StaleContentCollectionVersionError,
  SystemError,
} from "../../../../infrastructure/content-authoring/authoring-errors.js";
import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import type {
  ContentCollectionDto,
  ContentCollectionKind,
} from "../../facets/product-authoring/content-collection.contract.js";

export interface SetContentCollectionArchiveCommand {
  readonly actor: string;
  readonly archived: boolean;
  readonly collectionId: string;
  readonly expectedVersion: number;
  readonly kind: ContentCollectionKind;
}

export type SetContentCollectionArchiveError =
  | ContentCollectionNotFoundError
  | ForbiddenError
  | InvalidContentError
  | InvalidReferenceError
  | StaleContentCollectionVersionError
  | SystemError;

export type SetContentCollectionArchiveResult = Result<
  ContentCollectionDto,
  SetContentCollectionArchiveError
>;

export type SetContentCollectionArchiveOperation = (
  command: SetContentCollectionArchiveCommand,
) => Promise<SetContentCollectionArchiveResult>;
