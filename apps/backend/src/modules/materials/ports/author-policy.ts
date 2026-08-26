export interface PublicationAuthorizationRequest {
  readonly action: "publish" | "unpublish";
  readonly principalId: string;
  readonly materialId: string;
  readonly revisionId: string;
}

export interface AuthorPolicy {
  canAuthor(principalId: string): boolean | Promise<boolean>;
  canPublish(request: PublicationAuthorizationRequest): boolean | Promise<boolean>;
}

export type AuthorAuthorization =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "forbidden" }
        | { readonly code: "dependency_unavailable"; readonly retryable: true };
    };

async function authorize(
  check: () => boolean | Promise<boolean>,
): Promise<AuthorAuthorization> {
  try {
    return (await check())
      ? { ok: true }
      : { ok: false, error: { code: "forbidden" } };
  } catch {
    return {
      ok: false,
      error: { code: "dependency_unavailable", retryable: true },
    };
  }
}

export function authorizePublish(
  policy: AuthorPolicy,
  request: PublicationAuthorizationRequest,
): Promise<AuthorAuthorization> {
  return authorize(() => policy.canPublish(request));
}

export function authorizeAuthor(
  policy: AuthorPolicy,
  principalId: string,
): Promise<AuthorAuthorization> {
  return authorize(() => policy.canAuthor(principalId));
}
