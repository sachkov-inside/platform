import type { PublicationState } from "../../domain/material.js";
import type { ForbiddenError, SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface AuthoringMaterialReferenceDto {
  readonly id: string;
  readonly name: string;
}

export interface AuthoringMaterialListItemDto {
  readonly materialId: string;
  readonly title: string | null;
  readonly publicationState: PublicationState;
  readonly contentVersion: number;
  readonly topic: AuthoringMaterialReferenceDto | null;
  readonly format: AuthoringMaterialReferenceDto | null;
  readonly updatedAt: string;
}

export interface AuthoringMaterialPageDto {
  readonly items: readonly AuthoringMaterialListItemDto[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export interface ListMaterialsQuery {
  readonly actor: string;
  readonly first: number;
  readonly page: number;
  readonly publicationState?: PublicationState;
  readonly search?: string;
}

export type ListMaterialsError = ForbiddenError | SystemError;
export type ListMaterialsResult = Result<AuthoringMaterialPageDto, ListMaterialsError>;
export type ListMaterialsOperation = (
  query: ListMaterialsQuery,
) => Promise<ListMaterialsResult>;
