"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { subscribeEnrollmentChange, billingErrorMessage } from "@/entities/subscription";
import { readSubscriptionEnrollments } from "../api/enrollments.browser";

/** Every open owner surface observes assignment changes from other windows. */
export function useOwnerEnrollments(accountId: string) {
  const cache = useQueryClient();
  useEffect(() => subscribeEnrollmentChange(() => {
    void cache.invalidateQueries({ queryKey: ["owner-enrollments"] });
  }), [cache]);
  return useQuery({ queryKey: ["owner-enrollments", accountId], enabled: accountId !== "", queryFn: async () => {
    const result = await readSubscriptionEnrollments({ operationId: crypto.randomUUID(), accountId });
    if (!result.ok) throw new Error(billingErrorMessage(result.code));
    return result.value.result.items;
  } });
}
