export interface AuthenticatedReadFailure {
  readonly kind:
    | "authentication_required"
    | "identity_unavailable"
    | "dependency_unavailable";
  readonly reference?: string;
}
export interface AuthenticatedReadRejection {
  readonly kind: "rejected";
  readonly status: number;
  readonly body: unknown;
  readonly reference?: string;
}
export type AuthenticatedReadResult<T> =
  | { readonly kind: "ready"; readonly value: T }
  | AuthenticatedReadFailure
  | AuthenticatedReadRejection;
