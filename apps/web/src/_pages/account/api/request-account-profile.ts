import type { PrivateMemberProfileState } from "@/entities/member-profile";
import { parsePrivateProfileState } from "./member-profile-contract";

export async function requestAccountProfile(
  signal: AbortSignal,
): Promise<AccountProfileResult> {
  let response: Response;
  try {
    response = await fetch("/api/account/profile", {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    return { kind: "unavailable", reference: "profile-bff" };
  }
  if (response.status === 401) return { kind: "unauthorized" };
  if (!response.ok) {
    return {
      kind: "unavailable",
      reference: response.headers.get("x-correlation-id") ?? "profile-bff",
    };
  }
  try {
    const payload = await response.json() as unknown;
    if (typeof payload !== "object" || payload === null || !("canManageMaterials" in payload) || typeof payload.canManageMaterials !== "boolean" || !("state" in payload)) {
      throw new TypeError("Account response shape is invalid");
    }
    return {
      canManageMaterials: payload.canManageMaterials,
      kind: "ready",
      state: parsePrivateProfileState(payload.state),
    };
  } catch {
    return { kind: "unavailable", reference: "profile-bff-contract" };
  }
}

export type AccountProfileResult =
  | {
      readonly canManageMaterials: boolean;
      readonly kind: "ready";
      readonly state: PrivateMemberProfileState;
    }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unavailable"; readonly reference: string };
