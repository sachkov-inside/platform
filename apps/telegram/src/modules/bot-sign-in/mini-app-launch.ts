import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const hashSchema = z.hex().length(64);
const authDateSchema = z.coerce.number().int().positive();
export const miniAppLaunchLifetimeMilliseconds = 5 * 60 * 1000;
const maximumFutureClockSkewMilliseconds = 30 * 1000;
const userSchema = z.object({
  id: z
    .number()
    .int()
    .positive()
    .max(2 ** 52 - 1),
  is_bot: z.literal(false).optional(),
});

export interface VerifiedMiniAppLaunch {
  readonly telegramUserId: string;
  readonly authenticatedAt: Date;
  readonly proofDigest: string;
}

/** Telegram identity proof only; the caller must bind and consume a browser attempt. */
export function verifyMiniAppLaunch(input: {
  readonly initData: string;
  readonly botToken: string;
  readonly now: Date;
}): VerifiedMiniAppLaunch | undefined {
  const fields = new URLSearchParams(input.initData);
  if (new Set(fields.keys()).size !== fields.size) return undefined;
  const hash = hashSchema.safeParse(fields.get("hash"));
  const authDate = authDateSchema.safeParse(fields.get("auth_date"));
  if (!hash.success || !authDate.success) return undefined;
  fields.delete("hash");
  const data = [...fields.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData")
    .update(input.botToken)
    .digest();
  const expected = createHmac("sha256", key).update(data).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash.data, "hex")))
    return undefined;
  let rawUser: unknown;
  try {
    rawUser = JSON.parse(fields.get("user") ?? "null");
  } catch {
    // Not a dependency failure: the signed launch contains malformed user JSON.
    return undefined;
  }
  const user = userSchema.safeParse(rawUser);
  if (!user.success) return undefined;
  const authenticatedAt = new Date(authDate.data * 1000);
  const ageMilliseconds = input.now.getTime() - authenticatedAt.getTime();
  if (
    !Number.isFinite(ageMilliseconds) ||
    ageMilliseconds > miniAppLaunchLifetimeMilliseconds ||
    ageMilliseconds < -maximumFutureClockSkewMilliseconds
  )
    return undefined;
  return {
    telegramUserId: String(user.data.id),
    authenticatedAt,
    proofDigest: createHash("sha256")
      .update(data)
      .update(expected)
      .digest("base64url"),
  };
}
