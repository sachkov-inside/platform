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
  let response: Response;
  try {
    response = await fetch("/api/account", {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    return { kind: "unavailable", reference: "account-bff" };
  }
  if (response.status === 401) return { kind: "unauthorized" };
  if (!response.ok) {
    return {
      kind: "unavailable",
      reference: response.headers.get("x-correlation-id") ?? "account-bff",
    };
  }
  try {
    const parsed = accountPresentationSchema.parse(await response.json());
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
