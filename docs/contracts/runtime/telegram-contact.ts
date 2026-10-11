import { z } from "zod";

export const telegramContactQuerySchema: z.ZodObject<{
  accountRef: z.ZodString;
  telegramIdentityRef: z.ZodString;
}, z.core.$strict> = z.strictObject({
  accountRef: z.string().min(1).max(256),
  telegramIdentityRef: z.string().min(1).max(256),
});
export type TelegramContactQuery = z.infer<typeof telegramContactQuerySchema>;

export const telegramContactsRequestSchema: z.ZodObject<{
  contractVersion: z.ZodLiteral<"inside.telegram-contact.v1">;
  contacts: z.ZodArray<typeof telegramContactQuerySchema>;
}, z.core.$strict> = z.strictObject({
  contractVersion: z.literal("inside.telegram-contact.v1"),
  contacts: z.array(telegramContactQuerySchema).max(100),
});

export const telegramContactSchema: z.ZodObject<{
  accountRef: z.ZodString;
  telegramIdentityRef: z.ZodString;
  status: z.ZodEnum<{ available: "available"; not_found: "not_found"; unavailable: "unavailable" }>;
  displayName: z.ZodNullable<z.ZodString>;
  username: z.ZodNullable<z.ZodString>;
}, z.core.$strict> = z.strictObject({
  accountRef: z.string().min(1).max(256),
  telegramIdentityRef: z.string().min(1).max(256),
  status: z.enum(["available", "not_found", "unavailable"]),
  displayName: z.string().trim().min(1).max(160).nullable(),
  username: z.string().regex(/^[A-Za-z0-9_]{1,64}$/u).nullable(),
});
export type TelegramContact = z.infer<typeof telegramContactSchema>;

export const telegramContactsResponseSchema: z.ZodObject<{
  contractVersion: z.ZodLiteral<"inside.telegram-contact.v1">;
  contacts: z.ZodArray<typeof telegramContactSchema>;
}, z.core.$strict> = z.strictObject({
  contractVersion: z.literal("inside.telegram-contact.v1"),
  contacts: z.array(telegramContactSchema).max(100),
});
