import { z } from "zod";
import { accessCapabilitySchema } from "./access-grant.js";
import {
  enrollmentOriginSchema,
  enrollmentTermsSchema,
} from "./subscription-enrollment.js";

/** Закончившееся основание остаётся в списке людей столько после своего конца. */
export const RECENTLY_ENDED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Основание «истекает», когда до его конца осталось не больше этого срока. */
export const ENDING_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Откуда у человека доступ: origin назначения или разовая покупка. Ручное и прежнее (`legacy`)
 * право без назначения показываются как `manual`.
 */
export const accessSourceSchema = z.enum([
  ...enrollmentOriginSchema.options,
  "one_time_purchase",
]);
export type AccessSource = z.infer<typeof accessSourceSchema>;
export const accessGroundStateSchema = z.enum([
  "scheduled",
  "active",
  "ended",
  "revoked",
]);
export type AccessGroundState = z.infer<typeof accessGroundStateSchema>;
/** Фильтр состояния: действует, действует и кончается за 7 дней, закончилось за 30 дней. */
export const accessHolderStateSchema = z.enum(["active", "expiring", "ended"]);
export type AccessHolderState = z.infer<typeof accessHolderStateSchema>;

export const listAccessHoldersSchema = z.strictObject({
  operationId: z.uuid(),
  offerId: z.uuid().optional(),
  source: accessSourceSchema.optional(),
  state: accessHolderStateSchema.optional(),
  cursor: z.uuid().optional(),
  limit: z.int().min(1).max(100).default(50),
});
export type ListAccessHoldersCommand = z.infer<typeof listAccessHoldersSchema>;

/**
 * Одно основание доступа человека. `enrollment` меняется через `enrollments.change`, кроме
 * назначения из платежа: его меняют отмена продления и возврат. Ручное право меняется через
 * `grants.extend` и `grants.revoke`; оплаченное разовое право меняет только возврат.
 * `offer` у разовой покупки называет Billing по платежу, у ручного права его нет.
 */
export const accessGroundSchema = z.strictObject({
  kind: z.enum(["enrollment", "grant"]),
  id: z.uuid(),
  revision: z.int().positive(),
  source: accessSourceSchema,
  offer: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
  capabilities: z.array(accessCapabilitySchema),
  /** Платёж разовой покупки; у остальных оснований `null`. */
  purchaseRef: z.uuid().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  /** Правило конца назначения; у права без назначения `null`. */
  endPolicy: enrollmentTermsSchema.shape.endPolicy.nullable(),
  state: accessGroundStateSchema,
});
export type AccessGround = z.infer<typeof accessGroundSchema>;

export const accessHolderSchema = z.strictObject({
  accountId: z.uuid(),
  /** Текущая подтверждённая Telegram identity; без привязки `null`. */
  telegramIdentityRef: z.string().nullable(),
  grounds: z.array(accessGroundSchema),
});
export type AccessHolder = z.infer<typeof accessHolderSchema>;

/** Воронка приглашений за всё время: каждое приглашение считается в своём текущем состоянии. */
export const invitationFunnelSchema = z.strictObject({
  issued: z.int().nonnegative(),
  /** Открыто ботом хотя бы раз, в любом последующем состоянии. */
  opened: z.int().nonnegative(),
  /** Погашено в режиме оплаты: человеку открыта покупка. */
  purchaseOpened: z.int().nonnegative(),
  /** Из них Account купил этот Offer после погашения. */
  paid: z.int().nonnegative(),
  gifted: z.int().nonnegative(),
  expired: z.int().nonnegative(),
  revoked: z.int().nonnegative(),
});
export type InvitationFunnel = z.infer<typeof invitationFunnelSchema>;

/** Состояние основания в момент `now`: отзыв окончателен, затем начало и конец срока. */
export function accessGroundState(
  row: {
    readonly startsAt: Date;
    readonly endsAt: Date | null;
    readonly revokedAt: Date | null;
  },
  now: Date,
): AccessGroundState {
  if (row.revokedAt !== null) return "revoked";
  if (row.startsAt > now) return "scheduled";
  if (row.endsAt !== null && row.endsAt <= now) return "ended";
  return "active";
}
