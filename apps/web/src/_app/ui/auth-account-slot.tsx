import { cookies } from "next/headers";

import { hasLogtoSessionCookie } from "@/shared/auth/index.server";
import { type AuthControlState } from "@/widgets/auth-control";

import { AuthStatusControl } from "./auth-status-control.client";

interface AuthAccountSlotProps {
  readonly presentation: "desktop" | "mobile";
}

export async function AuthAccountSlot({ presentation }: AuthAccountSlotProps) {
  const state = await resolveAuthControlState();
  return renderControl(presentation, state);
}

export function AuthControlFallback({ presentation }: AuthAccountSlotProps) {
  return renderControl(presentation, "guest");
}

async function resolveAuthControlState(): Promise<AuthControlState> {
  const cookieNames = (await cookies()).getAll().map(({ name }) => name);
  return hasLogtoSessionCookie(cookieNames) ? "authenticated" : "guest";
}

function renderControl(
  presentation: AuthAccountSlotProps["presentation"],
  state: AuthControlState,
) {
  return <AuthStatusControl initialState={state} presentation={presentation} />;
}
