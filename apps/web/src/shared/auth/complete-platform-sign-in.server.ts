import "server-only";

import { decodeJwt } from "jose";

import {
  BackendConnectionError,
  establishAccount,
  completeTelegramAccountSignIn,
  resolveAccount,
} from "@/shared/api/backend/index.server";

export async function completePlatformSignIn(
  accessToken: string,
): Promise<"complete" | "retryable"> {
  if (decodeJwt(accessToken).inside_telegram_sign_in !== undefined) {
    try { await completeTelegramAccountSignIn(accessToken); return "complete"; }
    catch (error) { return handleCompletionError(error); }
  }
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
