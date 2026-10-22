import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { waitlistReadSchema } from "../model/product-waitlist-response";

import {
  beginWaitlistIntentOperation,
  joinWaitlistOperation,
  withdrawWaitlistOperation,
} from "./product-waitlist.operation";
export async function readWaitlist(
  productId: string,
  accountId: string | null,
  signal?: AbortSignal,
) {
  const result = await requestAuthenticatedRead(
    `/api/product-waitlist?productId=${encodeURIComponent(productId)}`,
    signal,
  );
  if (result.kind !== "ready") return { kind: "unavailable" } as const;
  const parsed = waitlistReadSchema.safeParse(result.value).data;
  return parsed?.kind === "ready" && parsed.accountId !== accountId
    ? { kind: "unavailable" as const }
    : (parsed ?? { kind: "unavailable" as const });
}
export function beginWaitlistIntent(productId: string, source: string | null) {
  return beginWaitlistIntentOperation.send({ productId, source });
}
export function joinWaitlist(productId: string) {
  return joinWaitlistOperation.send({ productId });
}
export function withdrawWaitlist(productId: string) {
  return withdrawWaitlistOperation.send({ productId });
}
