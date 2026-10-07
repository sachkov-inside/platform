import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { z } from "zod";

import { parsePrivateProfileState } from "@/entities/member-profile";

import type { AccountPresentationResult } from "../model/account-presentation";
import { accountTelegramMembershipSchema } from "../model/account-telegram-membership";

const accountPresentationSchema = z
  .object({
    profile: z.unknown(),
    telegramMembership: accountTelegramMembershipSchema,
  })
  .strict();

export async function requestAccountPresentation(
  signal: AbortSignal,
): Promise<AccountPresentationResult> {
  const result = await requestAuthenticatedRead("/api/account", signal);
  if (result.kind === "authentication_required")
    return { kind: "unauthorized" };
  if (result.kind !== "ready")
    return {
      kind: "unavailable",
      reference: result.reference ?? "account-bff",
    };
  try {
    const parsed = accountPresentationSchema.parse(result.value);
    return {
      kind: "ready",
      presentation: {
        profile: parsePrivateProfileState(parsed.profile),
        telegramMembership: parsed.telegramMembership,
      },
    };
  } catch {
    return { kind: "unavailable", reference: "account-bff-contract" };
  }
}
