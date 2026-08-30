export interface AuthoringMaterialsQuery {
  readonly page: number;
  readonly publicationState?: "draft" | "published" | "unpublished";
  readonly search?: string;
}

export interface AuthoringMaterialListItem {
  readonly canDelete: boolean;
  readonly contentVersion: number;
  readonly format: string | null;
  readonly materialId: string;
  readonly publicationState: "draft" | "published" | "unpublished";
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
