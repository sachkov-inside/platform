"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { subscribeEnrollmentChange, enrollmentsSchema, readBillingEndpoint, billingErrorMessage } from "@/entities/subscription";

const ownEnrollmentsKey = ["own-subscription-enrollments"] as const;
/** Cabinet navigation and contents share one read, including ended assignments. */
export function useOwnEnrollments() {
  const cache = useQueryClient();
  useEffect(() => subscribeEnrollmentChange(() => {
    void cache.invalidateQueries({ queryKey: ownEnrollmentsKey });
  }), [cache]);
  return useQuery({ queryKey: ownEnrollmentsKey, queryFn: async () => {
    const result = await readBillingEndpoint("/api/account/billing/enrollments", enrollmentsSchema);
    if (!result.ok) throw new Error(billingErrorMessage(result.code));
    return result.value.items;
  } });
}
