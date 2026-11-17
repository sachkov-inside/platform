"use client";

import type { QueryKey } from "@tanstack/react-query";

import { subscribeEnrollmentChange } from "@/entities/subscription";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";

const enrollmentChanges = { subscribe: subscribeEnrollmentChange };

/** Keeps People access reads current across the browser's access writes (#2379). */
export function useAccessChangeRefresh(queryKey: QueryKey): void {
  useAnnouncedRefresh(enrollmentChanges, queryKey);
}
