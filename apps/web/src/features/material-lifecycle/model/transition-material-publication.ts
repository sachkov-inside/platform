export interface TransitionMaterialPublicationInput {
  readonly expectedContentVersion: number;
  readonly materialId: string;
  readonly publicationState: "published" | "unpublished";
  readonly submissionId: string;
}

export interface MaterialPublicationIssue {
  readonly code: string;
  readonly path: string;
}

export type TransitionMaterialPublicationResult =
  | {
      readonly contentVersion: number;
      readonly kind: "saved";
      readonly nextSubmissionId: string;
      readonly publicationState: "published" | "unpublished";
    }
  | {
      readonly issues: readonly MaterialPublicationIssue[];
      readonly kind: "invalid_input";
    }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" }
  | {
      readonly currentContentVersion?: number;
      readonly kind: "conflict";
      readonly reason:
        | "idempotency_key_reused"
        | "invalid_publication_transition"
        | "stale_content_version";
    }
  | { readonly kind: "infrastructure_error"; readonly reference: string }
  | { readonly kind: "unexpected_error"; readonly reference: string };
