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
  const [status, setStatus] = useState<AuthStatusSnapshot>(initialStatus);

  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = () => {
      const current = ++generation;
      void loadAuthStatus().then((authoritativeStatus) => {
        if (!active || generation !== current) return;
        setStatus((previous) =>
          sameAuthStatus(previous, authoritativeStatus)
            ? previous
            : authoritativeStatus,
        );
      });
    };
    // Первый `pageshow` приходит вместе с загрузкой, которую уже проверяет монтирование; повторять
    // проверку нужно, только когда страница вернулась из кеша истории.
    const refreshRestoredPage = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refreshRestoredPage);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refreshRestoredPage);
    };
  }, []);

  return status;
}

/** Снимки равны, когда совпадает каждое их поле: новое поле снимка сравнивается само. */
function sameAuthStatus(
  left: AuthStatusSnapshot,
  right: AuthStatusSnapshot,
): boolean {
  const rightFields: ReadonlyMap<string, unknown> = new Map(
    Object.entries(right),
  );
  return Object.entries(left).every(
    ([key, value]) => rightFields.get(key) === value,
  );
}

function loadAuthStatus(): Promise<AuthStatusSnapshot> {
  return fetch("/auth/status", {
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
