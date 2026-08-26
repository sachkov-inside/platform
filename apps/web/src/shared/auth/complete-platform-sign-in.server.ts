import "server-only";

import {
  BackendConnectionError,
  establishAccount,
} from "@/shared/api/backend/index.server";

export async function completePlatformSignIn(
  accessToken: string,
): Promise<"complete" | "retryable"> {
  try {
    await establishAccount(accessToken);
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code !== "unavailable") {
      throw error;
    }
    return "retryable";
  }
  return "complete";
}
