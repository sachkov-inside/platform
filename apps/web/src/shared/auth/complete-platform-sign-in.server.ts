import "server-only";

import {
  BackendConnectionError,
  establishAccount,
  resolveAccount,
} from "@/shared/api/backend/index.server";

export async function completePlatformSignIn(
  accessToken: string,
): Promise<"complete" | "retryable"> {
  try {
    await resolveAccount(accessToken);
    return "complete";
  } catch (error) {
    if (!(error instanceof BackendConnectionError) || error.code !== "rejected") {
      return handleCompletionError(error);
    }
  }

  try {
    await establishAccount(accessToken);
    return "complete";
  } catch (error) {
    return handleCompletionError(error);
  }
}

function handleCompletionError(error: unknown): "retryable" {
  if (error instanceof BackendConnectionError && error.code !== "unavailable") {
    throw error;
  }
  return "retryable";
}
