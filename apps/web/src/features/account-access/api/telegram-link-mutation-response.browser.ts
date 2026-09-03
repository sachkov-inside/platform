import { z } from "zod";

import type { SameOriginMutationResult } from "@/shared/api/same-origin-mutation";

import {
  telegramLinkStateSchema,
  type TelegramLinkMutationResult,
} from "../model/account-telegram-membership";

const resultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("received"), state: telegramLinkStateSchema }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("unavailable"), reference: z.string() }).strict(),
]);

export function parseTelegramLinkMutationResponse(
  response: SameOriginMutationResult,
  operation: "begin" | "confirm",
): TelegramLinkMutationResult {
  if (!response.ok) {
    return response.status === 401 || response.status === 403
      ? { kind: "unauthorized" }
      : {
          kind: "unavailable",
          reference: `${operation}-telegram-link-bff-${String(response.status)}`,
        };
  }
  const parsed = resultSchema.safeParse(response.body);
  return parsed.success
    ? parsed.data
    : {
        kind: "unavailable",
        reference: `${operation}-telegram-link-bff-contract`,
      };
}
