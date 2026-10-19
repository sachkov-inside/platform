import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import {
  waitlistReadSchema,
  waitlistMutationSchema,
} from "../model/product-waitlist-response";
function form(productId: string) {
  const data = new FormData();
  data.set("productId", productId);
  return data;
}
export async function readWaitlist(productId: string) {
  const result = await requestAuthenticatedRead(
    `/api/product-waitlist?productId=${encodeURIComponent(productId)}`,
  );
  if (result.kind !== "ready") return { kind: "unavailable" } as const;
  return (
    waitlistReadSchema.safeParse(result.value).data ?? {
      kind: "unavailable" as const,
    }
  );
}
export async function beginWaitlistIntent(
  productId: string,
  source: string | null,
) {
  const data = form(productId);
  if (source !== null) data.set("source", source);
  const result = await requestSameOriginMutation(
    "/api/product-waitlist/intent",
    "POST",
    data,
  );
  return result.ok
    ? (waitlistMutationSchema.safeParse(result.body).data ?? {
        kind: "unavailable" as const,
      })
    : { kind: "unavailable" as const };
}
export async function joinWaitlist(productId: string) {
  const result = await requestSameOriginMutation(
    "/api/product-waitlist/join",
    "POST",
    form(productId),
  );
  return result.ok
    ? (waitlistMutationSchema.safeParse(result.body).data ?? {
        kind: "unavailable" as const,
      })
    : { kind: "unavailable" as const };
}
export async function withdrawWaitlist(productId: string) {
  const result = await requestSameOriginMutation(
    "/api/product-waitlist/withdraw",
    "POST",
    form(productId),
  );
  return result.ok
    ? (waitlistMutationSchema.safeParse(result.body).data ?? {
        kind: "unavailable" as const,
      })
    : { kind: "unavailable" as const };
}
