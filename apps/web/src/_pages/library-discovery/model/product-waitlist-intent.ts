import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const WAITLIST_INTENT_LIFETIME_SECONDS = 15 * 60;
export const WAITLIST_INTENT_COOKIE = "inside_waitlist_intent";
const intentSchema = z.strictObject({
  purpose: z.literal("product-waitlist.v1"),
  operationId: z.uuid(),
  productId: z.uuid(),
  intakeId: z.uuid(),
  accountId: z.uuid().nullable(),
  source: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/u)
    .nullable(),
  issuedAt: z.int().nonnegative(),
  expiresAt: z.int().nonnegative(),
});
export type WaitlistIntent = z.infer<typeof intentSchema>;
function signature(payload: string, key: string): Buffer {
  return createHmac("sha256", key)
    .update(`inside:product-waitlist.v1:${payload}`)
    .digest();
}
/** A short-lived explicit action, carried only by a same-site HttpOnly cookie, never a login credential. */
export function signWaitlistIntent(
  input: Pick<
    WaitlistIntent,
    "productId" | "intakeId" | "accountId" | "source"
  >,
  key: string,
  now: Date,
): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const intent = intentSchema.parse({
    ...input,
    purpose: "product-waitlist.v1",
    operationId: randomUUID(),
    issuedAt,
    expiresAt: issuedAt + WAITLIST_INTENT_LIFETIME_SECONDS,
  });
  const payload = Buffer.from(JSON.stringify(intent)).toString("base64url");
  return `${payload}.${signature(payload, key).toString("base64url")}`;
}
export function verifyWaitlistIntent(
  token: string | undefined,
  key: string,
  now: Date,
): WaitlistIntent | null {
  if (token === undefined || token.length > 2048) return null;
  const [payload, mac, ...extra] = token.split(".");
  if (payload === undefined || mac === undefined || extra.length !== 0)
    return null;
  const expected = signature(payload, key);
  const actual = Buffer.from(mac, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  try {
    const parsed = intentSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (!parsed.success) return null;
    const at = Math.floor(now.getTime() / 1000);
    return parsed.data.issuedAt <= at &&
      parsed.data.expiresAt > at &&
      parsed.data.expiresAt - parsed.data.issuedAt ===
        WAITLIST_INTENT_LIFETIME_SECONDS
      ? parsed.data
      : null;
  } catch {
    // Not a dependency failure: signed but invalid cookie payload is untrusted input.
    return null;
  }
}
