import { z } from "zod";
import { contentScopeEntrySchema, contentScopeSchema } from "@inside/access-capabilities";
import { accessCapabilitySchema } from "./billing-contract";
export const tierSchema = z.object({ id: z.uuid(), revision: z.int().positive(), name: z.string(),
  benefits: z.array(accessCapabilitySchema), contentScope: contentScopeSchema });
export const enrollmentSchema = z.object({ id: z.uuid(), accountId: z.uuid(), tier: tierSchema,
  origin: z.enum(["course", "tribute", "manual", "platform_payment"]), startsAt: z.iso.datetime(), endsAt: z.iso.datetime().nullable(),
  endPolicy: z.enum(["fixed", "confirmed_external", "temporary_membership"]), revision: z.int().positive(),
  state: z.enum(["scheduled", "active", "expired", "revoked", "pending_verification", "suspended_source"]), content: z.array(contentScopeEntrySchema).optional(), history: z.array(z.object({ kind: z.string(), reason: z.string(), recordedAt: z.iso.datetime() })).optional(), renewal: z.enum(["not_applicable", "billing_agreement"]), benefitTerms: z.array(z.object({ capability: z.string(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime().nullable(), revoked: z.boolean() })).optional(), nextChargeAt: z.iso.datetime().nullable().optional() });
export const enrollmentsSchema = z.object({ items: z.array(enrollmentSchema) });
export type Enrollment = z.infer<typeof enrollmentSchema>;
export const enrollmentSourceLabels = { course: "Предоставлено за курс", tribute: "Оплачено через Tribute", manual: "Назначено владельцем", platform_payment: "Оформлено на Platform" } as const;
export const enrollmentStateLabels = { scheduled: "Начнётся позже", active: "Действует", expired: "Срок завершён", revoked: "Отозвано", pending_verification: "Ожидает проверки", suspended_source: "Основание приостановлено" } as const;
