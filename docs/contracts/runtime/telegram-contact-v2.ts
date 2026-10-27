import { z } from "zod";
import {
  telegramContactQuerySchema,
  telegramContactSchema,
} from "./telegram-contact.js";

/** Longest normalized search text; a longer name fragment is not a support lookup. */
export const TELEGRAM_CONTACT_SEARCH_QUERY_MAX = 64;
/** Largest page one search may return. */
export const TELEGRAM_CONTACT_SEARCH_LIMIT_MAX = 50;

/**
 * Text both sides compare: trimmed, without one leading `@`. Control characters are rejected,
 * so a query can never span the separator of stored search text. `undefined` means invalid.
 */
export function normalizeTelegramContactSearchQuery(
  raw: string,
): string | undefined {
  const trimmed = raw.trim();
  const query = (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).trim();
  return query.length >= 1 &&
    query.length <= TELEGRAM_CONTACT_SEARCH_QUERY_MAX &&
    !/\p{Cc}/u.test(query)
    ? query
    : undefined;
}

export const telegramContactSearchRequestSchema: z.ZodObject<{
  contractVersion: z.ZodLiteral<"inside.telegram-contact.v2">;
  query: z.ZodString;
  limit: z.ZodNumber;
}, z.core.$strict> = z.strictObject({
  contractVersion: z.literal("inside.telegram-contact.v2"),
  query: z
    .string()
    .max(128)
    .refine(
      (value) => normalizeTelegramContactSearchQuery(value) !== undefined,
    ),
  limit: z.number().int().min(1).max(TELEGRAM_CONTACT_SEARCH_LIMIT_MAX),
});
export type TelegramContactSearchRequest = z.infer<
  typeof telegramContactSearchRequestSchema
>;

export const telegramContactMatchSchema: z.ZodObject<{
  accountRef: z.ZodString;
  telegramIdentityRef: z.ZodString;
  displayName: z.ZodNullable<z.ZodString>;
  username: z.ZodNullable<z.ZodString>;
}, z.core.$strict> = z.strictObject({
  accountRef: telegramContactSchema.shape.accountRef,
  telegramIdentityRef: telegramContactSchema.shape.telegramIdentityRef,
  displayName: telegramContactSchema.shape.displayName,
  username: telegramContactSchema.shape.username,
});
export type TelegramContactMatch = z.infer<typeof telegramContactMatchSchema>;

export const telegramContactSearchResponseSchema: z.ZodObject<{
  contractVersion: z.ZodLiteral<"inside.telegram-contact.v2">;
  matches: z.ZodArray<typeof telegramContactMatchSchema>;
  truncated: z.ZodBoolean;
}, z.core.$strict> = z.strictObject({
  contractVersion: z.literal("inside.telegram-contact.v2"),
  matches: z
    .array(telegramContactMatchSchema)
    .max(TELEGRAM_CONTACT_SEARCH_LIMIT_MAX),
  truncated: z.boolean(),
});
export type TelegramContactSearchResponse = z.infer<
  typeof telegramContactSearchResponseSchema
>;

export const telegramContactsV2RequestSchema: z.ZodObject<{
  contractVersion: z.ZodLiteral<"inside.telegram-contact.v2">;
  contacts: z.ZodArray<typeof telegramContactQuerySchema>;
}, z.core.$strict> = z.strictObject({
  contractVersion: z.literal("inside.telegram-contact.v2"),
  contacts: z.array(telegramContactQuerySchema).max(100),
});

/** `/stop` state of the contact in Telegram communications; `unknown` carries no claim. */
export const telegramContactMarketingSchema: z.ZodEnum<{
  enabled: "enabled";
  stopped: "stopped";
  unknown: "unknown";
}> = z.enum(["enabled", "stopped", "unknown"]);
export type TelegramContactMarketing = z.infer<
  typeof telegramContactMarketingSchema
>;

export const telegramContactV2Schema: z.ZodObject<{
  accountRef: z.ZodString;
  telegramIdentityRef: z.ZodString;
  status: z.ZodEnum<{
    available: "available";
    not_found: "not_found";
    unavailable: "unavailable";
  }>;
  displayName: z.ZodNullable<z.ZodString>;
  username: z.ZodNullable<z.ZodString>;
  marketing: typeof telegramContactMarketingSchema;
}, z.core.$strict> = z
  .strictObject({
    ...telegramContactSchema.shape,
    marketing: telegramContactMarketingSchema,
  })
  // A pair that is not a current link reveals nothing about the person behind it.
  .refine(
    (contact) =>
      contact.status !== "not_found" ||
      (contact.displayName === null &&
        contact.username === null &&
        contact.marketing === "unknown"),
  )
  .refine(
    (contact) =>
      contact.status === "available" ||
      (contact.displayName === null && contact.username === null),
  );
export type TelegramContactV2 = z.infer<typeof telegramContactV2Schema>;

export const telegramContactsV2ResponseSchema: z.ZodObject<{
  contractVersion: z.ZodLiteral<"inside.telegram-contact.v2">;
  contacts: z.ZodArray<typeof telegramContactV2Schema>;
}, z.core.$strict> = z.strictObject({
  contractVersion: z.literal("inside.telegram-contact.v2"),
  contacts: z.array(telegramContactV2Schema).max(100),
});
