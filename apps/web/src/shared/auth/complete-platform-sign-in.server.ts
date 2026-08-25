import "server-only";

import {
  BackendConnectionError,
  establishIdentitySession,
} from "@/shared/api/backend/index.server";

import { clearSignInAttempt, writePlatformSession } from "./index.server";

export async function completePlatformSignIn(command: {
  readonly accessToken: string;
  readonly attemptId: string;
}): Promise<"complete" | "retryable"> {
  let subject;
  try {
    subject = await establishIdentitySession({
      accessToken: command.accessToken,
      idempotencyKey: command.attemptId,
    });
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code !== "unavailable") {
      throw error;
    }
    return "retryable";
  }

  try {
    await writePlatformSession({
      sessionRef: subject.sessionRef,
      expiresAt: subject.expiresAt,
    });
    await clearSignInAttempt();
    return "complete";
  } catch {
    return "retryable";
  }
}
