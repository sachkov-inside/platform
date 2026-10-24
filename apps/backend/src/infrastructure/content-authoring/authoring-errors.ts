export type InvalidReferenceError = {
  readonly code: "invalid_reference";
  readonly issues: readonly { readonly code: string; readonly path: string }[];
};
export type ProductOrdinalConflictError = {
  readonly code: "product_ordinal_conflict";
  readonly productId: string;
  readonly ordinal: number;
};
export type SystemError =
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };
export type IdempotencyError = { readonly code: "idempotency_key_reused" };
export type ForbiddenError = { readonly code: "forbidden" };
export type MaterialNotFoundError = { readonly code: "material_not_found" };
export type StaleContentVersionError = {
  readonly code: "stale_content_version";
  readonly currentContentVersion: number;
};
export type InvalidPublicationTransitionError = {
  readonly code: "invalid_publication_transition";
  readonly currentState: "draft" | "published" | "unpublished";
  readonly targetState: "draft" | "published" | "unpublished";
};
/** Руководство с держателями права, из которого операция убрала бы опубликованный материал. */
export interface HeldProductRemoval {
  readonly productId: string;
  readonly name: string;
  readonly holders: number;
}
/**
 * Снять опубликованный материал из купленного руководства можно только подтверждением: команда
 * повторяется с перечисленными руководствами, а снятие записывается в журнал.
 */
export type ProductRemovalConfirmationRequiredError = {
  readonly code: "product_removal_confirmation_required";
  readonly products: readonly HeldProductRemoval[];
};
export type ContentCollectionNotFoundError = {
  readonly code: "content_collection_not_found";
};
export type ContentCollectionSlugConflictError = {
  readonly code: "content_collection_slug_conflict";
};
export type StaleContentCollectionVersionError = {
  readonly code: "stale_content_collection_version";
  readonly currentVersion: number;
};

export type InvalidContentError = {
  readonly code: "invalid_content";
  readonly issues: readonly { readonly code: string; readonly path: string }[];
};
export type DuplicateTagError = {
  readonly code: "duplicate_tag";
  readonly tagId: string;
};
