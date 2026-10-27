import type { OverviewPeriodDays } from "@/features/admin-overview";
import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

import {
  overviewStateSchema,
  type OverviewState,
} from "../model/overview-report";

/** Обзор через BFF; отказ всей страницы и сбой остаются состояниями страницы. */
export async function requestOverview(
  period: OverviewPeriodDays,
  signal: AbortSignal,
): Promise<OverviewState> {
  const result = await requestAuthenticatedRead(
    `/api/authoring/overview?period=${String(period)}`,
    signal,
  );
  if (result.kind === "authentication_required") return { kind: "signed_out" };
  if (result.kind === "rejected") {
    const parsed = overviewStateSchema.safeParse(result.body);
    return parsed.success && parsed.data.kind !== "ready"
      ? parsed.data
      : { kind: "unavailable", reference: result.reference ?? "overview" };
  }
  if (result.kind !== "ready")
    return { kind: "unavailable", reference: result.reference ?? "overview" };
  const parsed = overviewStateSchema.safeParse(result.value);
  return parsed.success && parsed.data.kind === "ready"
    ? parsed.data
    : { kind: "unavailable", reference: "malformed-response" };
}
