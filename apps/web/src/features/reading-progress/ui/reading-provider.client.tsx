"use client";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  MaterialReadingScope,
  type MaterialReadingSnapshot,
} from "@/entities/material";
import { useReadingAccountCache } from "../model/use-reading-account-cache.client";
import { getReadingStates } from "../api/reading.browser";
import { createReadingStateBatcher } from "../model/reading-state-batcher";
import { readingProgressChanges } from "../model/reading-progress-events";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";

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
  const visibleAccountId = useReadingAccountCache(
    queryClient,
    accountId,
    resolved,
  );
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
  // пересоздаётся, когда аккаунт сменился после первого ответа о входе.
  const [loadState] = useState(() =>
    createReadingStateBatcher(getReadingStates),
  );
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["reading-progress", accountId, "material", id],
      enabled: resolved && visibleAccountId !== null,
      queryFn: () => loadState(id),
      retry: false,
    })),
  });
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["reading-progress"] });
  }, [queryClient]);
  const changes = useMemo(
    () =>
      !resolved || accountId === null
        ? null
        : readingProgressChanges(accountId),
    [accountId, resolved],
  );
  useAnnouncedRefresh(changes, ["reading-progress", accountId]);
  const states = new Map<string, MaterialReadingSnapshot>();
  if (resolved && visibleAccountId !== null)
    for (const result of results)
      if (!result.isError && result.data !== undefined)
        states.set(result.data.materialId, result.data);
  return (
    <MaterialReadingScope
      value={{
        accountId: visibleAccountId,
        resolved,
        states,
        register,
        refresh,
        failed: results.some((result) => result.isError),
      }}
    >
      {children}
    </MaterialReadingScope>
  );
}
