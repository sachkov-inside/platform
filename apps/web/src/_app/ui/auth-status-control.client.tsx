"use client";

import { useEffect, useState } from "react";

import {
  DesktopAuthControl,
  type AuthControlState,
  MobileAuthControl,
} from "@/widgets/auth-control";

interface AuthStatusControlProps {
  readonly accountLabel?: string | undefined;
  readonly initialState: AuthControlState;
  readonly presentation: "desktop" | "mobile";
}

let statusFlight: Promise<AuthControlState> | undefined;

export function AuthStatusControl({
  accountLabel,
  initialState,
  presentation,
}: AuthStatusControlProps) {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    if (initialState === "guest") {
      return;
    }
    let active = true;
    void loadAuthStatus().then((authoritativeState) => {
      if (active) {
        setState(authoritativeState);
      }
    });
    return () => {
      active = false;
    };
  }, [initialState]);

  const displayedState = initialState === "guest" ? "guest" : state;

  return presentation === "desktop" ? (
    <DesktopAuthControl accountLabel={accountLabel} state={displayedState} />
  ) : (
    <MobileAuthControl accountLabel={accountLabel} state={displayedState} />
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
