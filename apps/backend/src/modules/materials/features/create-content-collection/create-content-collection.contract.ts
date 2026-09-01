import type {
  ContentCollectionSlugConflictError,
  ForbiddenError,
  InvalidContentError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";
import type {
  ContentCollectionDto,
  ContentCollectionKind,
} from "../list-content-collections/list-content-collections.contract.js";

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
