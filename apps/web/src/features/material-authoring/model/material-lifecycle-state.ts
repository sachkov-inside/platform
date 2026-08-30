export type MaterialLifecycleOperation = "delete" | "publish" | "unpublish";

export interface MaterialLifecycleIssue {
  readonly code: string;
  readonly path: string;
}

export type MaterialLifecycleActionState =
  | { readonly kind: "idle" }
  | {
      readonly contentVersion: number;
      readonly kind: "saved";
      readonly nextSubmissionId: string;
      readonly publicationState: "published" | "unpublished";
    }
  | { readonly kind: "deleted"; readonly materialId: string }
  | {
      readonly issues: readonly MaterialLifecycleIssue[];
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
        | "invalid_publication_transition"
        | "stale_content_version";
    }
  | { readonly kind: "infrastructure_error"; readonly reference: string }
  | { readonly kind: "unexpected_error"; readonly reference: string };

export const initialMaterialLifecycleActionState = {
  kind: "idle",
} as const satisfies MaterialLifecycleActionState;
