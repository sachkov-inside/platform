import "server-only";

import {
  BackendConnectionError,
  requestCurrentAccountTelegramMembership,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import {
  accountTelegramMembershipSchema,
  type AccountTelegramMembership,
} from "@/features/account-access/model/account-telegram-membership";

export type AccountTelegramMembershipResult =
  | Readonly<{ kind: "ready"; presentation: AccountTelegramMembership }>
  | Readonly<{ kind: "unauthorized" }>
  | Readonly<{ kind: "unavailable"; reference: string }>;

export async function getAccountTelegramMembership(
  accessToken: string,
  request: typeof requestCurrentAccountTelegramMembership =
    requestCurrentAccountTelegramMembership,
): Promise<AccountTelegramMembershipResult> {
  let result: BackendTransportResult;
  try {
    result = await request(accessToken);
  } catch (error) {
    return unavailable(error);
  }
  if (!result.ok) {
    return result.response.status === 401
      ? { kind: "unauthorized" }
      : { kind: "unavailable", reference: "telegram-membership-response" };
  }
  const parsed = accountTelegramMembershipSchema.safeParse(result.body);
  return parsed.success
    ? { kind: "ready", presentation: parsed.data }
    : { kind: "unavailable", reference: "telegram-membership-contract" };
}

function unavailable(error: unknown): AccountTelegramMembershipResult {
  return {
    kind: "unavailable",
    reference:
      error instanceof BackendConnectionError
        ? error.code
        : "telegram-membership-contract",
  };
}
