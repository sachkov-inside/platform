"use client";
import { useQuery } from "@tanstack/react-query";

import { billingErrorMessage } from "@/entities/subscription";

import { readAccessSummary } from "../api/access.browser";
import { AccessSummaryView } from "./access-summary-view.client";
import { accessSummaryQueryKey } from "./people-panel.client";

export function AccessSummaryPanel() {
  const summary = useQuery({
    queryKey: accessSummaryQueryKey,
    queryFn: async () => {
      // Чтение ничего не меняет: каждому чтению своя ссылка на операцию.
      const result = await readAccessSummary({
        operationId: crypto.randomUUID(),
      });
      if (!result.ok) throw new Error(billingErrorMessage(result.code));
      return result.value.result.value;
    },
  });
  return (
    <AccessSummaryView
      error={summary.error?.message ?? null}
      loading={summary.isPending}
      summary={summary.data ?? null}
    />
  );
}
