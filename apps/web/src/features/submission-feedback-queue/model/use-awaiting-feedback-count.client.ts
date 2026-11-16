"use client";

import { useQuery } from "@tanstack/react-query";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";

import { requestAwaitingFeedbackCount } from "../api/awaiting-feedback-count.browser";
import {
  authorFeedbackWritten,
  awaitingFeedbackCountQueryKey,
} from "./awaiting-feedback-count";

/**
 * Счётчик сдач без комментария для каркаса. `null` — числа нет: у аккаунта нет права на сдачи,
 * сессия закончилась или чтение не удалось; каркас тогда не рисует счётчик, а не пишет ноль.
 */
export function useAwaitingFeedbackCount(): number | null {
  const query = useQuery({
    queryKey: awaitingFeedbackCountQueryKey,
    queryFn: ({ signal }) => requestAwaitingFeedbackCount(signal),
  });
  useAnnouncedRefresh(authorFeedbackWritten, awaitingFeedbackCountQueryKey);
  return query.data?.kind === "ready" ? query.data.count : null;
}
