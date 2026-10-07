import "server-only";

import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import { getAccountTelegramMembership } from "./get-account-telegram-membership";
import { getPrivateMemberProfile } from "./get-private-member-profile";

export async function handleAccountPresentationRequest(): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const [profile, telegramMembership] = await Promise.all([
      getPrivateMemberProfile(accessToken),
      getAccountTelegramMembership(accessToken),
    ]);
    if (
      profile.kind === "unauthorized" ||
      telegramMembership.kind === "unauthorized"
    ) {
      return new Response(null, { status: 401 });
    }
    if (profile.kind === "unavailable") {
      return unavailableResponse(profile.reference);
    }
    if (telegramMembership.kind === "unavailable") {
      return unavailableResponse(telegramMembership.reference);
    }
    return Response.json({
      profile: profile.state,
      telegramMembership: telegramMembership.presentation,
    });
  });
}

function unavailableResponse(reference: string): Response {
  return new Response(null, {
    headers: { "x-correlation-id": reference },
    status: 503,
  });
}
