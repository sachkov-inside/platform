"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  MaterialReadingContext,
  type MaterialReadingSnapshot,
} from "@/entities/material";
import { clearOtherReadingAccounts } from "../model/reading-cache";
import { getReadingStates } from "../api/reading.browser";
import { createReadingStateBatcher } from "../model/reading-state-batcher";

/** One account-scoped reader shared by visible Material cards and Reader: cached per Material, read in batches. */
export function ReadingProgressProvider({
  accountId,
  resolved,
  children,
}: {
  readonly accountId: string | null;
  readonly resolved: boolean;
  readonly children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [signedOut, setSignedOut] = useState(false);
  const registrations = useRef(new Map<string, number>());
  const [ids, setIds] = useState<string[]>([]);
  const register = useCallback((id: string) => {
    const counts = registrations.current;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (counts.get(id) === 1) setIds([...counts.keys()].sort());
    return () => {
      const count = counts.get(id) ?? 0;
      if (count > 1) counts.set(id, count - 1);
      else {
        counts.delete(id);
        setIds([...counts.keys()].sort());
      }
    };
  }, []);
  // Запросы одного такта собираются в пакет; у аккаунта свой сборщик, потому что провайдер
  // пересоздаётся при смене аккаунта.
  const [loadState] = useState(() =>
    createReadingStateBatcher(getReadingStates),
  );
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["reading-progress", accountId, "material", id],
      enabled: resolved && accountId !== null && !signedOut,
      queryFn: () => loadState(id),
      retry: false,
    })),
  });
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["reading-progress"] });
  }, [queryClient]);
  useEffect(() => {
    if (resolved) clearOtherReadingAccounts(queryClient, accountId);
  }, [accountId, queryClient, resolved]);
  useEffect(() => {
    const clear = (event: Event) => {
      const form = event.target;
      if (
        form instanceof HTMLFormElement &&
        new URL(form.action).pathname === "/auth/sign-out"
      ) {
        setSignedOut(true);
        clearOtherReadingAccounts(queryClient, null);
      }
    };
    document.addEventListener("submit", clear, true);
    return () => {
      document.removeEventListener("submit", clear, true);
    };
  }, [queryClient]);
  const states = new Map<string, MaterialReadingSnapshot>();
  if (resolved && !signedOut && accountId !== null)
    for (const result of results)
      if (!result.isError && result.data !== undefined)
        states.set(result.data.materialId, result.data);
  return (
    <MaterialReadingContext
      value={{
        accountId: signedOut ? null : accountId,
        resolved,
        states,
        register,
        refresh,
        failed: results.some((result) => result.isError),
      }}
    >
      {children}
    </MaterialReadingContext>
  );
}
