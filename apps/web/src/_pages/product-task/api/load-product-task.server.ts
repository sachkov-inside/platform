import type { QueryClient } from "@tanstack/react-query";
import { taskSubmissionsQueryKey } from "../model/task-submissions-query";
import "server-only";

import {
  BackendConnectionError,
  resolveAccount,
  requestProductTaskPage,
  requestOwnTaskSubmissions,
} from "@/shared/api/backend/index.server";

import {
  productTaskPageSchema,
  ownTaskSubmissionsSchema,
  type ProductTaskPageResult,
  type OwnSubmissionsView,
} from "../model/product-task-page";

/**
 * The task page as the viewer sees it; never cached (ADR 0027): access, requirements and the
 * submission setting are personal or change without a new address. A malformed answer throws to
 * the route's error boundary.
 */
export async function getProductTaskPage(
  productSlug: string,
  code: string,
  accessToken?: string,
): Promise<ProductTaskPageResult> {
  try {
    const result = await requestProductTaskPage(
      productSlug,
      code,
      accessToken === undefined ? {} : { accessToken },
    );
    if (!result.ok) {
      const status = result.response.status;
      if (status === 404 || status === 400) return { kind: "not-found" };
      if (status === 503) return { kind: "unavailable" };
      throw new BackendConnectionError(
        "backend-error",
        `Product Task page answered ${String(status)}`,
      );
    }
    const parsed = productTaskPageSchema.safeParse(result.body);
    if (!parsed.success)
      throw new BackendConnectionError(
        "invalid-response",
        "Product Task page does not match the contract",
        { cause: parsed.error },
      );
    return parsed.data.access === "open"
      ? { kind: "open", page: parsed.data }
      : { kind: "closed", task: parsed.data.task };
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable")
      return { kind: "unavailable" };
    throw error;
  }
}

/** The signed-in reader's own submissions; a failure here leaves the task readable. */
export async function loadOwnSubmissions(
  code: string,
  accessToken: string | undefined,
  after?: string,
): Promise<OwnSubmissionsView> {
  if (accessToken === undefined) return { kind: "guest" };
  try {
    const result = await requestOwnTaskSubmissions(code, accessToken, after);
    if (!result.ok)
      return result.response.status === 401
        ? { kind: "guest" }
        : { kind: "unavailable" };
    const parsed = ownTaskSubmissionsSchema.safeParse(result.body);
    return parsed.success
      ? { kind: "ready", ...parsed.data, continued: after !== undefined }
      : { kind: "unavailable" };
  } catch (error) {
    if (error instanceof BackendConnectionError) return { kind: "unavailable" };
    throw error;
  }
}

/** Identity must be established before personal history enters the browser query cache. */
export async function prefetchOwnTaskSubmissions(
  client: QueryClient,
  code: string,
  accessToken: string | undefined,
  after?: string,
): Promise<{
  readonly accountId: string | null;
  readonly submissions: OwnSubmissionsView;
}> {
  if (accessToken === undefined)
    return { accountId: null, submissions: { kind: "guest" } };
  let accountId: string;
  try {
    accountId = (await resolveAccount(accessToken)).accountId;
  } catch (error) {
    if (error instanceof BackendConnectionError)
      return { accountId: null, submissions: { kind: "unavailable" } };
    throw error;
  }
  const submissions = await client.query({
    queryKey: taskSubmissionsQueryKey(accountId, code, after),
    queryFn: () => loadOwnSubmissions(code, accessToken, after),
  });
  return { accountId, submissions };
}
