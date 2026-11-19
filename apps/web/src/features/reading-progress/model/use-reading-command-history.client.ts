"use client";
import { useMemo, useEffect } from "react";
import {
  useMutationState,
  useIsMutating,
  type QueryClient,
} from "@tanstack/react-query";
import { readingCommandSchema, readingResultSchema } from "./reading-contract";

/** Command history is shared by actions for one material and account in the same cache. */
export function useReadingCommandHistory(
  queryClient: QueryClient,
  accountId: string | null,
  materialId: string,
  canMark: boolean,
) {
  const mutationKey = useMemo(
    () => ["reading-progress", accountId, "set-state", materialId] as const,
    [materialId, accountId],
  );
  // Новый доступный Reader снимает прежний отказ, сохраняя ошибки и ключи повторных команд.
  useEffect(() => {
    if (!canMark) return;
    const cache = queryClient.getMutationCache();
    for (const previous of cache.findAll({ mutationKey, exact: true }))
      if (
        previous.state.status === "success" &&
        readingResultSchema.safeParse(previous.state.data).data?.kind ===
          "denied"
      )
        cache.remove(previous);
  }, [canMark, mutationKey, queryClient]);
  const saving = useIsMutating({ mutationKey }) > 0;
  // Все представления материала наблюдают последнюю команду одного владельца кеша.
  const latest = useMutationState({
    filters: { mutationKey, exact: true },
    select: ({ state }) => ({
      status: state.status,
      result: readingResultSchema.safeParse(state.data).data,
      command: readingCommandSchema.safeParse(state.variables).data,
    }),
  }).at(-1);
  function clearFinished() {
    const cache = queryClient.getMutationCache();
    for (const previous of cache.findAll({ mutationKey, exact: true }))
      if (previous.state.status !== "pending") cache.remove(previous);
  }
  return { mutationKey, saving, latest, clearFinished };
}
