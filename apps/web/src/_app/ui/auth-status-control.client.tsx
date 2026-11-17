"use client";

import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";
import { browserReturns } from "../lib/auth-status-returns.client";

import type { AuthControlState } from "@/widgets/auth-control";

interface AuthStatusSnapshot {
  readonly accountId: string | null;
  readonly canManageMaterials: boolean;
  readonly resolved: boolean;
  readonly state: AuthControlState;
}

/** Ответ `/auth/status`: неизвестное состояние делает статус недоступным, неверные поля — пустыми. */
const authStatusPayloadSchema = z.object({
  accountId: z.uuid().nullable().catch(null),
  canManageMaterials: z.boolean().catch(false),
  state: z.enum(["authenticated", "guest", "unavailable"]),
});

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

/**
 * Статус входа для оболочки. Повторная проверка на `focus` и `pageshow` не сбрасывает уже известный
 * ответ: пока она идёт, личные блоки стоят на прежнем статусе, а меняются, только когда вход
 * действительно изменился. Каждая проверка спрашивает сервер заново и решает только последняя:
 * ответ на запрос, ушедший до выхода в другой вкладке, не держит эту вкладку во входе (#742).
 */
export function useAuthStatus(): AuthStatusSnapshot {
  const queryKey = ["auth-status"] as const;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadAuthStatus(signal),
    retry: false,
    // Waiting for reconnect would retain the previous Account snapshot offline (#2274).
    networkMode: "always",
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useAnnouncedRefresh(browserReturns, queryKey);
  // The browser QueryClient outlives a shell mount (#2274).
  return query.isFetchedAfterMount
    ? (query.data ?? unavailableStatus)
    : initialStatus;
}

function loadAuthStatus(signal: AbortSignal): Promise<AuthStatusSnapshot> {
  return fetch("/auth/status", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        return unavailableStatus;
      }
      const payload: unknown = await response.json();
      return parseAuthStatus(payload);
    })
    .catch(() => unavailableStatus);
}

function parseAuthStatus(value: unknown): AuthStatusSnapshot {
  const parsed = authStatusPayloadSchema.safeParse(value);
  if (!parsed.success) return unavailableStatus;
  const { accountId, canManageMaterials, state } = parsed.data;
  return {
    accountId: state === "authenticated" ? accountId : null,
    canManageMaterials: state === "authenticated" && canManageMaterials,
    resolved: true,
    state,
  };
}
