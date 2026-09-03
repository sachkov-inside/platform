import "server-only";

import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";

import { getAccountTelegramMembership } from "./get-account-telegram-membership";
import { getPrivateMemberProfile } from "./get-private-member-profile";

export async function handleAccountPresentationRequest(): Promise<Response> {
  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(readLogtoBffConfig());
  } catch (error) {
    return new Response(null, {
      headers: privateHeaders(),
      status: error instanceof LogtoSessionUnavailableError ? 401 : 503,
    });
  }

  const [profile, telegramMembership] = await Promise.all([
    getPrivateMemberProfile(accessToken),
    getAccountTelegramMembership(accessToken),
  ]);
  if (
    profile.kind === "unauthorized" ||
    telegramMembership.kind === "unauthorized"
  ) {
    return new Response(null, { headers: privateHeaders(), status: 401 });
  }
  if (profile.kind === "unavailable") {
    return unavailableResponse(profile.reference);
  }
  if (telegramMembership.kind === "unavailable") {
    return unavailableResponse(telegramMembership.reference);
  }
  return Response.json(
    {
      profile: profile.state,
      telegramMembership: telegramMembership.presentation,
    },
    { headers: privateHeaders() },
  );
}

function unavailableResponse(reference: string): Response {
  return new Response(null, {
    headers: { ...privateHeaders(), "x-correlation-id": reference },
    status: 503,
  });
}

function privateHeaders(): Record<string, string> {
  return { "cache-control": "no-store, private" };
}
