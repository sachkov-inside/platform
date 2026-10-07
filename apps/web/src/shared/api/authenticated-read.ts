export interface AuthenticatedReadFailure {
  readonly kind:
    | "authentication_required"
    | "identity_unavailable"
    | "dependency_unavailable";
  readonly reference?: string;
}
export type AuthenticatedReadResult<T> =
  { readonly kind: "ready"; readonly value: T } | AuthenticatedReadFailure;
