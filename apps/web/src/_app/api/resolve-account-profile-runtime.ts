import "server-only";

import { cache } from "react";

import type { PrivateMemberProfile } from "@/_pages/account";
import { getPrivateMemberProfile } from "@/_pages/account.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";

export type AccountProfileRuntime =
  | { readonly kind: "guest" }
  | { readonly kind: "authenticated"; readonly profile: PrivateMemberProfile | null }
  | { readonly kind: "unavailable" };

export const resolveAccountProfileRuntime = cache(
  async (): Promise<AccountProfileRuntime> => {
    let accessToken: string | undefined;
    try {
      accessToken = await getOptionalPlatformAccessToken();
    } catch {
      return { kind: "unavailable" };
    }
    if (accessToken === undefined) return { kind: "guest" };
    const result = await getPrivateMemberProfile(accessToken);
    if (result.kind === "unauthorized") return { kind: "guest" };
    if (result.kind === "unavailable") return { kind: "unavailable" };
    return {
      kind: "authenticated",
      profile: result.state.kind === "profile" ? result.state.profile : null,
    };
  },
);
