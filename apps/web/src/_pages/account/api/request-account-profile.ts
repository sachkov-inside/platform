import type { PrivateMemberProfileResult } from "../model/member-profile";
import { parsePrivateProfileState } from "./member-profile-contract";

export async function requestAccountProfile(
  signal: AbortSignal,
): Promise<PrivateMemberProfileResult> {
  let response: Response;
  try {
    response = await fetch("/account/profile-state", {
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
    return { kind: "ready", state: parsePrivateProfileState(await response.json()) };
  } catch {
    return { kind: "unavailable", reference: "profile-bff-contract" };
  }
}
