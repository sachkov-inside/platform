import type { TransactionHandle } from "../prisma/transaction-handle.js";
import { dependencyFailure } from "../observability/index.js";
export interface AuthorPolicy {
  canManage(
    accountId: string,
    handle?: TransactionHandle,
  ): boolean | Promise<boolean>;
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
  handle?: TransactionHandle,
): Promise<AuthorAuthorization> {
  try {
    return (await policy.canManage(accountId, handle))
      ? { ok: true }
      : { ok: false, error: { code: "forbidden" } };
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "authorizeManager" },
      error,
      {
        ok: false,
        error: { code: "dependency_unavailable", retryable: true },
      },
    );
  }
}
