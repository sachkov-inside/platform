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
  | StaleContentCollectionVersionError
  | SystemError;

export type SetContentCollectionArchiveResult = Result<
  ContentCollectionDto,
  SetContentCollectionArchiveError
>;

export type SetContentCollectionArchiveOperation = (
  command: SetContentCollectionArchiveCommand,
) => Promise<SetContentCollectionArchiveResult>;
