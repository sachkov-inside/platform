"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { billingErrorMessage } from "@/entities/subscription";
import { respondentsStatus } from "../api/respondents.browser";
import { SurveyRespondentsView } from "./survey-respondents-view.client";
const queryKey = ["survey-respondents"];
/** Historical survey facts remain readable; new links use the common payment-link workflow. */
export function SurveyRespondentsPanel() {
  const cache = useQueryClient();
  const status = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await respondentsStatus({
        operationId: crypto.randomUUID(),
      });
      if (!result.ok) throw new Error(billingErrorMessage(result.code));
      return result.value.result.value;
    },
  });
  return (
    <SurveyRespondentsView
      data={status.data ?? null}
      loading={status.isPending}
      error={status.error?.message ?? null}
      onRefresh={() => {
        void cache.invalidateQueries({ queryKey });
      }}
    />
  );
}
