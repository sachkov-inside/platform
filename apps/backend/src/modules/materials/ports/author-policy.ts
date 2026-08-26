export interface AuthorPolicy {
  canManage(accountId: string): boolean | Promise<boolean>;
}

export type AuthorAuthorization =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "forbidden" }
        | { readonly code: "dependency_unavailable"; readonly retryable: true };
    };

export async function authorizeManager(
  policy: AuthorPolicy,
  accountId: string,
): Promise<AuthorAuthorization> {
  try {
    return (await policy.canManage(accountId))
      ? { ok: true }
      : { ok: false, error: { code: "forbidden" } };
  } catch {
    return {
      ok: false,
      error: { code: "dependency_unavailable", retryable: true },
    };
  }
}
