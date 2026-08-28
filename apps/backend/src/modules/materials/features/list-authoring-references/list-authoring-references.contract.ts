import type {
  ForbiddenError,
  SystemError,
} from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface AuthoringReferenceDto {
  readonly id: string;
  readonly name: string;
}

export interface ListAuthoringReferencesQuery {
  readonly actor: string;
}

export interface AuthoringReferencesDto {
  readonly formats: readonly AuthoringReferenceDto[];
  readonly tags: readonly AuthoringReferenceDto[];
  readonly topics: readonly AuthoringReferenceDto[];
}

export type ListAuthoringReferencesResult = Result<
  AuthoringReferencesDto,
  ForbiddenError | SystemError
>;

export type ListAuthoringReferencesOperation = (
  query: ListAuthoringReferencesQuery,
) => Promise<ListAuthoringReferencesResult>;
