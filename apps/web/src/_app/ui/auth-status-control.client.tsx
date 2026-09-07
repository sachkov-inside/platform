"use client";

import { z } from "zod";
import { useEffect, useState } from "react";

import type { AuthControlState } from "@/widgets/auth-control";

interface AuthStatusSnapshot {
  readonly accountId: string | null;
  readonly canManageMaterials: boolean;
  readonly resolved: boolean;
  readonly state: AuthControlState;
}

const initialStatus: AuthStatusSnapshot = {
  accountId: null,
  canManageMaterials: false,
  resolved: false,
  state: "guest",
};
const unavailableStatus: AuthStatusSnapshot = {
  accountId: null,
  canManageMaterials: false,
  resolved: true,
  state: "unavailable",
};

let statusFlight: Promise<AuthStatusSnapshot> | undefined;

export function useAuthStatus(): AuthStatusSnapshot {
  const [status, setStatus] = useState<AuthStatusSnapshot>(initialStatus);

  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      setStatus((previous) => ({ ...previous, resolved: false }));
      void loadAuthStatus().then((authoritativeStatus) => {
        if (active && generation === current) setStatus(authoritativeStatus);
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
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
  const accountId = z.uuid().safeParse((value as Record<string, unknown>).accountId);
  return {
    accountId: state === "authenticated" && accountId.success ? accountId.data : null,
    canManageMaterials:
      state === "authenticated" &&
      (value as Record<string, unknown>).canManageMaterials === true,
    resolved: true,
    state,
  };
}
