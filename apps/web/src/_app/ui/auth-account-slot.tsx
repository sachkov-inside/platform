import { type AuthControlState } from "@/widgets/auth-control";

import { resolveAccountProfileRuntime } from "../api/resolve-account-profile-runtime";
import { AuthStatusControl } from "./auth-status-control.client";

interface AuthAccountSlotProps {
  readonly presentation: "desktop" | "mobile";
}

export async function AuthAccountSlot({ presentation }: AuthAccountSlotProps) {
  const runtime = await resolveAccountProfileRuntime();
  return renderControl(
    presentation,
    runtime.kind === "authenticated" ? "authenticated" : runtime.kind,
    runtime.kind === "authenticated"
      ? runtime.profile?.displayName ?? "Настроить профиль"
      : undefined,
  );
}

export function AuthControlFallback({ presentation }: AuthAccountSlotProps) {
  return renderControl(presentation, "guest");
}

function renderControl(
  presentation: AuthAccountSlotProps["presentation"],
  state: AuthControlState,
  accountLabel?: string,
) {
  return (
    <AuthStatusControl
      accountLabel={accountLabel}
      initialState={state}
      presentation={presentation}
    />
  );
}
