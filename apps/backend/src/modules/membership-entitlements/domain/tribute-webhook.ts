import { createHash } from "node:crypto";
import { z } from "zod";

// Official Tribute OpenAPI, checked 2026-09-14. Unknown versions/fields require reconciliation.
const timestamp = z.iso.datetime({ offset: true });
const payload = z.strictObject({
  subscription_name: z.string(), subscription_id: z.int(), period_id: z.int(),
  period: z.enum(["monthly", "quarterly", "yearly"]), price: z.int(), amount: z.int(),
  currency: z.string(), user_id: z.int(), trb_user_id: z.string(), telegram_user_id: z.int().positive(),
  channel_id: z.int(), channel_name: z.string(), expires_at: timestamp,
  telegram_username: z.string().optional(), type: z.enum(["regular", "gift", "trial"]).optional(),
});
export const tributeWebhookSchema = z.discriminatedUnion("name", [
  z.strictObject({ name: z.literal("new_subscription"), created_at: timestamp, sent_at: timestamp, payload }),
  z.strictObject({ name: z.literal("renewed_subscription"), created_at: timestamp, sent_at: timestamp,
    payload: payload.extend({ type: z.enum(["regular", "gift", "trial"]), email: z.string().optional(), web_app_link: z.string().optional() }) }),
  z.strictObject({ name: z.literal("cancelled_subscription"), created_at: timestamp, sent_at: timestamp,
    payload: payload.extend({ cancel_reason: z.string() }) }),
]);
export type TributeWebhook = z.infer<typeof tributeWebhookSchema>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function tributeFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
/** sent_at is transport retry metadata, never the identity of a source event. */
export function tributeEventIdentity(event: TributeWebhook) {
  return {
    eventKey: tributeFingerprint([event.name, event.created_at, event.payload.subscription_id, event.payload.telegram_user_id]),
    fingerprint: tributeFingerprint({ name: event.name, created_at: event.created_at, payload: event.payload }),
  };
}
