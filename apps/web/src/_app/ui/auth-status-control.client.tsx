"use client";

import { useEffect, useState } from "react";

import {
  DesktopAuthControl,
  type AuthControlState,
  MobileAuthControl,
} from "@/widgets/auth-control";

interface AuthStatusControlProps {
  readonly accountLabel?: string | undefined;
  readonly presentation: "desktop" | "mobile";
}

let statusFlight: Promise<AuthControlState> | undefined;

export function AuthStatusControl({
  accountLabel,
  presentation,
}: AuthStatusControlProps) {
  const [state, setState] = useState<AuthControlState>("guest");

  useEffect(() => {
    let active = true;
    void loadAuthStatus().then((authoritativeState) => {
      if (active) {
        setState(authoritativeState);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return presentation === "desktop" ? (
    <DesktopAuthControl accountLabel={accountLabel} state={state} />
  ) : (
    <MobileAuthControl accountLabel={accountLabel} state={state} />
  );
}

function loadAuthStatus(): Promise<AuthControlState> {
  statusFlight ??= fetch("/auth/status", {
    cache: "no-store",
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) {
        return "unavailable";
      }
      const payload: unknown = await response.json();
      return isAuthControlStateResponse(payload) ? payload.state : "unavailable";
    })
    .catch(() => "unavailable" as const)
    .finally(() => {
      statusFlight = undefined;
    });
  return statusFlight;
}

function isAuthControlStateResponse(
  value: unknown,
): value is { readonly state: AuthControlState } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const state = (value as Record<string, unknown>).state;
  return state === "authenticated" || state === "guest" || state === "unavailable";
}
