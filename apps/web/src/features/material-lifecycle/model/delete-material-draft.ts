export interface DeleteMaterialDraftInput {
  readonly expectedContentVersion: number;
  readonly materialId: string;
  readonly submissionId: string;
}

export interface DeleteMaterialDraftIssue {
  readonly code: string;
  readonly path: string;
}

export type DeleteMaterialDraftResult =
  | { readonly kind: "deleted"; readonly materialId: string }
  | {
      readonly issues: readonly DeleteMaterialDraftIssue[];
      readonly kind: "invalid_input";
    }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" }
  | {
      readonly currentContentVersion?: number;
      readonly kind: "conflict";
      readonly reason:
        | "draft_deletion_forbidden"
        | "idempotency_key_reused"
        | "stale_content_version";
    }
  | { readonly kind: "infrastructure_error"; readonly reference: string }
  | { readonly kind: "unexpected_error"; readonly reference: string };
