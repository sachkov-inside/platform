import { z } from "zod";

const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
});
const linkRetrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirm"), linkRef: z.uuid() }).strict(),
  z.object({ kind: z.literal("refresh") }).strict(),
]);
const linkRecoverySchema = z
  .object({ kind: z.literal("support"), url: httpUrlSchema.optional() })
  .strict();
export const accountTelegramMembershipSchema = z
  .object({
    link: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("unlinked") }).strict(),
      z
        .object({
          expiresAt: z.iso.datetime({ offset: true }),
          kind: z.literal("linking"),
          linkRef: z.uuid(),
        })
        .strict(),
      z.object({ kind: z.literal("linked") }).strict(),
      z
        .object({
          kind: z.literal("conflict"),
          supportUrl: httpUrlSchema.optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("retryable"),
          reason: z.enum(["expired", "replayed"]),
        })
        .strict(),
      z
        .object({ kind: z.literal("unavailable"), retry: linkRetrySchema })
        .strict(),
      z
        .object({
          kind: z.literal("recovery-required"),
          recovery: linkRecoverySchema,
        })
        .strict(),
    ]),
    membership: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("active") }).strict(),
      z
        .object({ acquisitionUrl: httpUrlSchema, kind: z.literal("inactive") })
        .strict(),
      z.object({ kind: z.literal("stale") }).strict(),
      z.object({ kind: z.literal("unavailable") }).strict(),
    ]),
  })
  .strict();

export const telegramLinkStateSchema = z
  .object({
    deepLink: httpUrlSchema.optional(),
    expiresAt: z.iso.datetime({ offset: true }),
    linkRef: z.uuid(),
    status: z.enum([
      "conflict",
      "expired",
      "linked",
      "pending",
      "recovery-required",
      "replayed",
      "unavailable",
    ]),
  })
  .strict();

export type AccountTelegramMembership = Readonly<
  z.infer<typeof accountTelegramMembershipSchema>
>;
export type TelegramLinkState = Readonly<
  z.infer<typeof telegramLinkStateSchema>
>;
export type TelegramLinkMutationResult =
  | Readonly<{ kind: "received"; state: TelegramLinkState }>
  | Readonly<{ kind: "unauthorized" }>
  | Readonly<{ kind: "unavailable"; reference: string }>;
