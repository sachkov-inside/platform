"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  billingErrorMessage,
  subscribeEnrollmentChange,
} from "@/entities/subscription";

import { refreshAccessRead } from "../model/access-refresh";
import { subscribeInvitationChange } from "../model/invitation-events";
import { readAccessSummary } from "../api/access.browser";
import { AccessSummaryView } from "./access-summary-view.client";
import { accessSummaryQueryKey } from "../model/access-query-keys";

export function AccessSummaryPanel() {
  const cache = useQueryClient();
  useEffect(() => {
    const refresh = (announcementId: string) => {
      void refreshAccessRead(cache, accessSummaryQueryKey, announcementId);
    };
    const stopEnrollments = subscribeEnrollmentChange(refresh);
    const stopInvitations = subscribeInvitationChange(refresh);
    return () => {
      stopEnrollments();
      stopInvitations();
    };
  }, [cache]);
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
