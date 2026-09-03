"use client";

import { useEffect, useState } from "react";

import type { AuthControlState } from "@/widgets/auth-control";

interface AuthStatusSnapshot {
  readonly canManageMaterials: boolean;
  readonly resolved: boolean;
  readonly state: AuthControlState;
}

const initialStatus: AuthStatusSnapshot = {
  canManageMaterials: false,
  resolved: false,
  state: "guest",
};
const unavailableStatus: AuthStatusSnapshot = {
  canManageMaterials: false,
  resolved: true,
  state: "unavailable",
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
        return unavailableStatus;
      }
      const payload: unknown = await response.json();
      return parseAuthStatus(payload);
    })
    .catch(() => unavailableStatus)
    .finally(() => {
      statusFlight = undefined;
    });
  return statusFlight;
}

function parseAuthStatus(value: unknown): AuthStatusSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return unavailableStatus;
  }
  const state = (value as Record<string, unknown>).state;
  if (
    state !== "authenticated" &&
    state !== "guest" &&
    state !== "unavailable"
  ) {
    return unavailableStatus;
  }
  return {
    canManageMaterials:
      state === "authenticated" &&
      (value as Record<string, unknown>).canManageMaterials === true,
    resolved: true,
    state,
  };
}
