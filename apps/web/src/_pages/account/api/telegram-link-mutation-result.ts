import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import {
  telegramLinkStateSchema,
  type TelegramLinkMutationResult,
} from "../model/account-telegram-membership";

const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

export function mapTelegramLinkMutationResult(
  result: BackendTransportResult,
): TelegramLinkMutationResult {
  if (result.ok) {
    const parsed = telegramLinkStateSchema.safeParse(result.body);
    return parsed.success
      ? { kind: "received", state: parsed.data }
      : { kind: "unavailable", reference: "telegram-link-contract" };
  }
  if (result.response.status === 401) return { kind: "unauthorized" };
  const problem = problemSchema.safeParse(result.problem);
  return {
    kind: "unavailable",
    reference: problem.success
      ? (problem.data.correlationId ?? problem.data.code)
      : "telegram-link-response",
  };
}

export function unavailableTelegramLinkMutation(
  error: unknown,
): TelegramLinkMutationResult {
  return {
    kind: "unavailable",
    reference:
      error instanceof BackendConnectionError
        ? error.code
        : "telegram-link-contract",
  };
}
