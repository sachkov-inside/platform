"use client";

import { useEffect, useState } from "react";

import type { AuthControlState } from "@/widgets/auth-control";

interface AuthStatusSnapshot {
  readonly canManageMaterials: boolean;
  readonly state: AuthControlState;
}

const initialStatus: AuthStatusSnapshot = {
  canManageMaterials: false,
  state: "guest",
};

let statusFlight: Promise<AuthStatusSnapshot> | undefined;

export function useAuthStatus(): AuthStatusSnapshot {
  const [status, setStatus] = useState<AuthStatusSnapshot>(initialStatus);

  useEffect(() => {
    let active = true;
    void loadAuthStatus().then((authoritativeStatus) => {
      if (active) {
        setStatus(authoritativeStatus);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return status;
}

function loadAuthStatus(): Promise<AuthStatusSnapshot> {
  statusFlight ??= fetch("/auth/status", {
    cache: "no-store",
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) {
        return { canManageMaterials: false, state: "unavailable" } as const;
      }
      const payload: unknown = await response.json();
      return parseAuthStatus(payload);
    })
    .catch(
      () => ({ canManageMaterials: false, state: "unavailable" }) as const,
    )
    .finally(() => {
      statusFlight = undefined;
    });
  return statusFlight;
}

function parseAuthStatus(value: unknown): AuthStatusSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { canManageMaterials: false, state: "unavailable" };
  }
  const state = (value as Record<string, unknown>).state;
  if (
    state !== "authenticated" &&
    state !== "guest" &&
    state !== "unavailable"
  ) {
    return { canManageMaterials: false, state: "unavailable" };
  }
  return {
    canManageMaterials:
      state === "authenticated" &&
      (value as Record<string, unknown>).canManageMaterials === true,
    state,
  };
}
