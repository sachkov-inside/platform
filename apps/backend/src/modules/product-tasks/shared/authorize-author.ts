import { reportDependencyFailure } from "../../../infrastructure/observability/index.js";
import type { AuthorPolicy } from "../ports/author-policy.js";
import { scope, type Result } from "./result.js";

export type AuthorizationError =
  | { readonly code: "forbidden" }
  | { readonly code: "dependency_unavailable"; readonly retryable: true };

/**
 * Whether the actor may manage Product Tasks. A failed permission read is recorded under the
 * operation the caller invoked and answers as a retryable dependency failure.
 */
export async function authorizeAuthor(
  policy: AuthorPolicy,
  actor: string,
  operationName: string,
): Promise<Result<undefined, AuthorizationError>> {
  try {
    return (await policy.canManage(actor))
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: "forbidden" } };
  } catch (error) {
    reportDependencyFailure(scope(operationName), error);
    return {
      ok: false,
      error: { code: "dependency_unavailable", retryable: true },
    };
  }
}
