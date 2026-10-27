"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { requestAwaitingFeedbackCount } from "../api/awaiting-feedback-count.browser";
import {
  authorFeedbackWritten,
  awaitingFeedbackCountQueryKey,
  resetAwaitingFeedbackCount,
} from "./awaiting-feedback-count";

/**
 * Счётчик сдач без комментария для каркаса. `null` — числа нет: у аккаунта нет права на сдачи,
 * сессия закончилась или чтение не удалось; каркас тогда не рисует счётчик, а не пишет ноль.
 */
export function useAwaitingFeedbackCount(): number | null {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: awaitingFeedbackCountQueryKey,
    queryFn: ({ signal }) => requestAwaitingFeedbackCount(signal),
  });
  useEffect(
    () =>
      authorFeedbackWritten.subscribe(() => {
        void resetAwaitingFeedbackCount(queryClient);
      }),
    [queryClient],
  );
  return query.data?.kind === "ready" ? query.data.count : null;
}
