import type { MaterialFormat } from "@/shared/api/material-format";

export type MaterialPublicationState = "draft" | "published" | "unpublished";

/** The list state the address owns: every key is a URL parameter and a server filter. */
export interface AuthoringMaterialsQuery {
  readonly format?: MaterialFormat;
  readonly page: number;
  readonly publicationState?: MaterialPublicationState;
  readonly search?: string;
  /** A Topic id: the URL key is `topic`, the server parameter `topicId`. */
  readonly topicId?: string;
}

export interface AuthoringMaterialListItem {
  readonly canDelete: boolean;
  readonly contentVersion: number;
  readonly format: string | null;
  readonly materialId: string;
  readonly publicationState: MaterialPublicationState;
  readonly submissionId: string;
  readonly title: string | null;
  readonly topic: string | null;
  readonly updatedAt: string;
}

export type AuthoringMaterialsState =
  | {
      readonly kind: "ready";
      readonly items: readonly AuthoringMaterialListItem[];
      readonly page: number;
      readonly pageSize: number;
      readonly totalItems: number;
      readonly totalPages: number;
    }
  | { readonly kind: "signed_out" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable"; readonly reference: string }
  | { readonly kind: "malformed_response" }
  | { readonly kind: "unexpected_error"; readonly reference: string };

export interface AuthoringMaterialFilterOption<Value extends string = string> {
  readonly label: string;
  readonly value: Value;
}

/**
 * The choices of the Topic and format filters. `unavailable` keeps the filters usable for the
 * values already in the address; the list itself reports its own failures.
 */
export type AuthoringMaterialFilterOptions =
  | {
      readonly kind: "ready";
      readonly formats: readonly AuthoringMaterialFilterOption<MaterialFormat>[];
      readonly topics: readonly AuthoringMaterialFilterOption[];
    }
  | { readonly kind: "pending" }
  | { readonly kind: "unavailable" };
