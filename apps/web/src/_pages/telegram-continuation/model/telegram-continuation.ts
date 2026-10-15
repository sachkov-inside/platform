import { z } from "zod";

export const telegramContinuationSchema = z.union([
  z.object({ state: z.enum(["expired", "identity_conflict", "unavailable"]) }),
  z.object({
    state: z.enum(["link_required", "pending", "active"]),
    product: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
  }),
]);
export type TelegramContinuation = z.infer<typeof telegramContinuationSchema>;
export function telegramContinuationPath(attemptId: string): string {
  return `/telegram/continue?attempt=${encodeURIComponent(attemptId)}`;
}
