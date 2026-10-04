import { z } from "zod";
import { sourceRefSchema } from "./access-grant.js";
import { ACTIVATION_CONTRACT_VERSION } from "./subscription-activation.js";
import {
  enrollmentViewSchema,
  type TierSnapshot,
} from "./subscription-enrollment.js";

/** Неоткрытое приглашение сгорает через 14 дней после выдачи. */
export const INVITATION_OPEN_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
/** Закреплённое приглашение ждёт привязки Account столько же, сколько попытка активации. */
export const INVITATION_CLAIM_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/** 16 случайных байт — 22 символа base64url: deep link `i_<code>` короче 43 символов. */
export const INVITATION_CODE_BYTES = 16;
/** Префикс start-параметра бота, по которому бот узнаёт приглашение. */
export const INVITATION_START_PREFIX = "i_";

export const invitationCodeSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/u);
export const invitationModeSchema = z.enum(["purchase", "gift"]);
export type InvitationMode = z.infer<typeof invitationModeSchema>;
export const invitationStateSchema = z.enum([
  "issued",
  "claimed",
  "redeemed",
  "expired",
  "revoked",
]);
export type InvitationState = z.infer<typeof invitationStateSchema>;

export const issueInvitationSchema = z
  .strictObject({
    operationId: z.uuid(),
    offerId: z.uuid(),
    mode: invitationModeSchema,
    /** Срок подарка в календарных месяцах; `null` — бессрочно. Только для `gift`. */
    giftMonths: z.int().min(1).max(1200).nullable().default(null),
    /** Заметка владельца: кому выдано. В журнал владельческих команд не попадает. */
    note: z.string().trim().max(200).nullable().default(null),
  })
  .refine((value) => value.mode === "gift" || value.giftMonths === null, {
    path: ["giftMonths"],
  });
export const revokeInvitationSchema = z.strictObject({
  operationId: z.uuid(),
  invitationId: z.uuid(),
  expectedRevision: z.int().positive(),
});
export const listInvitationsSchema = z.strictObject({
  operationId: z.uuid(),
  state: invitationStateSchema.optional(),
  offerId: z.uuid().optional(),
  cursor: z.uuid().optional(),
  limit: z.int().min(1).max(100).default(50),
});

export const invitationViewSchema = z.strictObject({
  id: z.uuid(),
  code: invitationCodeSchema,
  /** Start-параметр бота: ссылка `t.me/<бот>?start=<startParameter>`. */
  startParameter: z.string().min(1).max(64),
  offerId: z.uuid(),
  offerRevision: z.int().positive(),
  mode: invitationModeSchema,
  giftMonths: z.int().min(1).max(1200).nullable(),
  note: z.string().max(200).nullable(),
  state: invitationStateSchema,
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  claimedAt: z.iso.datetime().nullable(),
  redeemedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  /** Account, получивший допуск или подарок; до погашения `null`. */
  accountId: z.uuid().nullable(),
  revision: z.int().positive(),
});
export type InvitationView = z.infer<typeof invitationViewSchema>;

interface InvitationRow {
  readonly id: string;
  readonly code: string;
  readonly offerId: string;
  readonly offerRevision: number;
  readonly mode: string;
  readonly giftMonths: number | null;
  readonly note: string | null;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly claimedAt: Date | null;
  readonly redeemedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly claimedAccountId: string | null;
  readonly revision: number;
}

/**
 * Состояние приглашения в момент `now`. Отзыв и погашение окончательны. Неоткрытое сгорает через
 * 14 дней после выдачи, закреплённое — через 30 дней после первого открытия.
 */
export function invitationState(
  row: Pick<
    InvitationRow,
    "expiresAt" | "claimedAt" | "redeemedAt" | "revokedAt"
  >,
  now: Date,
): InvitationState {
  if (row.revokedAt !== null) return "revoked";
  if (row.redeemedAt !== null) return "redeemed";
  if (row.claimedAt !== null)
    return now.getTime() - row.claimedAt.getTime() <
      INVITATION_CLAIM_LIFETIME_MS
      ? "claimed"
      : "expired";
  return now < row.expiresAt ? "issued" : "expired";
}

export function invitationView(row: InvitationRow, now: Date): InvitationView {
  return invitationViewSchema.parse({
    id: row.id,
    code: row.code,
    startParameter: `${INVITATION_START_PREFIX}${row.code}`,
    offerId: row.offerId,
    offerRevision: row.offerRevision,
    mode: row.mode,
    giftMonths: row.giftMonths,
    note: row.note,
    state: invitationState(row, now),
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    claimedAt: row.claimedAt?.toISOString() ?? null,
    redeemedAt: row.redeemedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    accountId: row.redeemedAt === null ? null : row.claimedAccountId,
    revision: row.revision,
  });
}

/** Запрос бота: код из `i_<code>` и приватно проверенная Telegram identity. */
export const redeemInvitationSchema = z.strictObject({
  contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION),
  code: invitationCodeSchema,
  identityRef: sourceRefSchema,
});

/** Offer приглашения, как его видит каталог в момент погашения. */
export interface InvitationOffer {
  readonly id: string;
  /** Offer продаётся: оплата ведёт на страницу оформления. */
  readonly purchasable: boolean;
  /** Снимок тарифа для подарка; `null` — Offer сейчас нельзя назначить. */
  readonly tier: TierSnapshot | null;
}

/**
 * Итог погашения внутри прав: billing добавляет к нему адрес оформления и имя Offer. Состояния без
 * Account и отказы не раскрывают ни Offer, ни режим.
 */
export type InvitationRedemption =
  | {
      readonly state:
        | "needs_account"
        | "claimed_by_other"
        | "expired"
        | "revoked"
        | "unavailable";
    }
  | {
      readonly state: "purchase_ready" | "already_redeemed";
      readonly mode: "purchase";
      readonly offerId: string;
    }
  | {
      readonly state: "gift_granted" | "already_redeemed";
      readonly mode: "gift";
      readonly offerId: string;
      readonly enrollment: z.infer<typeof enrollmentViewSchema>;
    };

const redemptionVersion = z.literal(ACTIVATION_CONTRACT_VERSION);
const offerNameSchema = z.string().trim().min(1).max(200);
const purchaseRedemption = {
  contractVersion: redemptionVersion,
  mode: z.literal("purchase"),
  offerName: offerNameSchema,
  /** Абсолютный адрес страницы оформления этого Offer на сайте. */
  checkoutUrl: z.url(),
};
const giftRedemption = {
  contractVersion: redemptionVersion,
  mode: z.literal("gift"),
  offerName: offerNameSchema,
  enrollment: enrollmentViewSchema,
};
/** Ответ погашения приглашения боту. Повтор погашённого приглашения повторяет его итог. */
export const invitationRedemptionOutcomeSchema = z.union([
  z.strictObject({
    contractVersion: redemptionVersion,
    state: z.enum([
      "needs_account",
      "claimed_by_other",
      "expired",
      "revoked",
      "unavailable",
    ]),
  }),
  z.strictObject({
    ...purchaseRedemption,
    state: z.literal("purchase_ready"),
  }),
  z.strictObject({ ...giftRedemption, state: z.literal("gift_granted") }),
  z.strictObject({
    ...purchaseRedemption,
    state: z.literal("already_redeemed"),
  }),
  z.strictObject({ ...giftRedemption, state: z.literal("already_redeemed") }),
]);
export type InvitationRedemptionOutcome = z.infer<
  typeof invitationRedemptionOutcomeSchema
>;
