import { z } from "zod";

import {
  defineMutationOperation,
  type MutationTransportFailure,
} from "@/shared/api/mutation-operation";

import {
  telegramLinkStateSchema,
  type TelegramLinkMutationResult,
} from "../model/account-telegram-membership";

const resultSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("received"), state: telegramLinkStateSchema })
    .strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("unavailable"), reference: z.string() }).strict(),
]);

function telegramLinkTransportFailure(
  operation: "begin" | "confirm",
  failure: MutationTransportFailure,
): TelegramLinkMutationResult {
  if (failure.kind === "status" && [401, 403].includes(failure.status))
    return { kind: "unauthorized" };
  return {
    kind: "unavailable",
    reference: `${operation}-telegram-link-bff-${failure.kind === "contract" ? "contract" : String(failure.status)}`,
  };
}

/** Starts linking the Account to Telegram; the server chooses the link. */
export const beginTelegramLinkOperation = defineMutationOperation({
  input: z.object({}),
  method: "POST",
  path: "/api/account/telegram-link/begin",
  result: resultSchema,
  transportFailure: (failure) => telegramLinkTransportFailure("begin", failure),
});

/** Confirms the Telegram link the Account opened. */
export const confirmTelegramLinkOperation = defineMutationOperation({
  input: z.object({ linkRef: z.uuid() }).strict(),
  method: "POST",
  path: "/api/account/telegram-link/confirm",
  result: resultSchema,
  transportFailure: (failure) =>
    telegramLinkTransportFailure("confirm", failure),
});
