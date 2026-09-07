"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { MaterialReadingContext, type MaterialReadingSnapshot } from "@/entities/material";
import { getReadingStates } from "../api/reading.browser";

/** One account-scoped batch reader shared by visible Material cards and Reader. */
export function ReadingProgressProvider({ accountId, resolved, children }: { readonly accountId: string | null; readonly resolved: boolean; readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const registrations = useRef(new Map<string, number>());
  const [ids, setIds] = useState<string[]>([]);
  const register = useCallback((id: string) => {
    const counts = registrations.current;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (counts.get(id) === 1) setIds([...counts.keys()].sort());
    return () => {
      const count = counts.get(id) ?? 0;
      if (count > 1) counts.set(id, count - 1);
      else { counts.delete(id); setIds([...counts.keys()].sort()); }
    };
  }, []);
  const batches = useMemo(() => {
    const result: string[][] = [];
    for (let offset = 0; offset < ids.length; offset += 100) result.push(ids.slice(offset, offset + 100));
    return result;
  }, [ids]);
  const results = useQueries({ queries: batches.map((batch) => ({
    queryKey: ["reading-progress", accountId, "materials", batch],
    enabled: resolved && accountId !== null,
    queryFn: async () => {
      const result = await getReadingStates(batch);
      if (result.kind !== "ready") throw new Error(result.kind);
      if (result.states.length !== batch.length || new Set(result.states.map((state) => state.materialId)).size !== batch.length || result.states.some((state) => !batch.includes(state.materialId))) throw new Error("invalid_response");
      return result.states;
    },
    staleTime: 0,
    retry: false,
  })) });
  const refresh = useCallback(async () => { await queryClient.invalidateQueries({ queryKey: ["reading-progress"] }); }, [queryClient]);
  useEffect(() => {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] === "reading-progress" && query.queryKey[1] !== accountId });
  }, [accountId, queryClient]);
  useEffect(() => {
    const clear = (event: Event) => {
      const form = event.target;
      if (form instanceof HTMLFormElement && new URL(form.action).pathname === "/auth/sign-out") {
        void queryClient.cancelQueries({ queryKey: ["reading-progress"] });
        queryClient.removeQueries({ queryKey: ["reading-progress"] });
      }
    };
    document.addEventListener("submit", clear, true);
    return () => { document.removeEventListener("submit", clear, true); };
  }, [queryClient]);
  const states = new Map<string, MaterialReadingSnapshot>();
  if (resolved && accountId !== null) for (const result of results) for (const state of result.isError ? [] : result.data ?? []) states.set(state.materialId, state);
  return <MaterialReadingContext value={{ accountId, resolved, states, register, refresh, failed: results.some((result) => result.isError) }}>{children}</MaterialReadingContext>;
}
