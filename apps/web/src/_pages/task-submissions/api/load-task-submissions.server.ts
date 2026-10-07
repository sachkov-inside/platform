import "server-only";

import {
  BackendConnectionError,
  requestAuthorTaskSubmissions,
} from "@/shared/api/backend/index.server";
import {
  getPlatformAccessTokenRsc,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import {
  consistentSelection,
  sameSelection,
  taskSubmissionsSchema,
  type SubmissionSelection,
  type TaskSubmissions,
} from "../model/task-submissions";

export type TaskSubmissionsOutcome =
  | {
      readonly kind: "ready";
      readonly submissions: TaskSubmissions;
      readonly selection: SubmissionSelection;
      /** Whether this page continues an earlier one: the list then offers a way back to the start. */
      readonly continued: boolean;
    }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable" };

type Attempt =
  | { readonly ok: true; readonly submissions: TaskSubmissions }
  | { readonly ok: false; readonly status: number };

/**
 * The «Сдачи» section for `/authoring/submissions` (#948). A filter the Products on offer cannot show
 * — a chapter of another Product, a task of another chapter, a malformed value — is dropped and read
 * again from the first page, so the selects and the list always agree.
 */
export async function loadTaskSubmissions(
  selection: SubmissionSelection,
  cursor: string | undefined,
): Promise<TaskSubmissionsOutcome> {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessTokenRsc(readLogtoBffConfig());
  } catch (error) {
    if (error instanceof LogtoSessionUnavailableError)
      return { kind: "unauthorized" };
    throw error;
  }
  const read = async (
    query: SubmissionSelection,
    page: string | undefined,
  ): Promise<Attempt> => {
    let result;
    try {
      result = await requestAuthorTaskSubmissions(
        { ...query, ...(page === undefined ? {} : { cursor: page }) },
        accessToken,
      );
    } catch (error) {
      if (error instanceof BackendConnectionError)
        return { ok: false, status: 503 };
      throw error;
    }
    if (!result.ok) return { ok: false, status: result.response.status };
    const parsed = taskSubmissionsSchema.safeParse(result.body);
    return parsed.success
      ? { ok: true, submissions: parsed.data }
      : { ok: false, status: 502 };
  };

  let shown = selection;
  let page = cursor;
  let attempt = await read(shown, page);
  // A stale or hand-edited address: read the whole list, then keep what of the filter still fits.
  if (!attempt.ok && attempt.status === 400) {
    shown = {};
    page = undefined;
    attempt = await read(shown, page);
  }
  if (attempt.ok) {
    const consistent = consistentSelection(
      selection,
      attempt.submissions.products,
    );
    if (!sameSelection(consistent, shown)) {
      shown = consistent;
      page = undefined;
      attempt = await read(shown, page);
    }
  }
  if (!attempt.ok) {
    if (attempt.status === 401) return { kind: "unauthorized" };
    if (attempt.status === 403) return { kind: "forbidden" };
    return { kind: "unavailable" };
  }
  return {
    kind: "ready",
    submissions: attempt.submissions,
    selection: shown,
    continued: page !== undefined,
  };
}
