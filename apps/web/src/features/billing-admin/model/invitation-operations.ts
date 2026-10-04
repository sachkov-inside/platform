import { z } from "zod";

import type { PriceSnapshot } from "@/entities/subscription";

/** Приглашения (#908): вход и исходы трёх владельческих операций billing. */
export const invitationStateSchema = z.enum([
  "issued",
  "claimed",
  "redeemed",
  "expired",
  "revoked",
]);
export const invitationModeSchema = z.enum(["purchase", "gift"]);

/** Срок подарка в месяцах; `null` — бессрочно. Границы те же, что принимает команда. */
export const giftMonthsMax = 1200;
export const invitationNoteMaxLength = 200;
/** Страница списка: сервер по умолчанию отдаёт столько же. */
export const invitationsPageSize = 50;

export const issueInvitationInputSchema = z.strictObject({
  operationId: z.uuid(),
  offerId: z.uuid(),
  mode: invitationModeSchema,
  giftMonths: z.int().min(1).max(giftMonthsMax).nullable().optional(),
  note: z.string().max(invitationNoteMaxLength).nullable().optional(),
});
export const revokeInvitationInputSchema = z.strictObject({
  operationId: z.uuid(),
  invitationId: z.uuid(),
  expectedRevision: z.int().nonnegative(),
});
export const listInvitationsInputSchema = z.strictObject({
  operationId: z.uuid(),
  state: invitationStateSchema.optional(),
  offerId: z.uuid().optional(),
  cursor: z.uuid().optional(),
  limit: z.int().min(1).max(100),
});

const moment = z.iso.datetime({ offset: true });
export const invitationSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  startParameter: z.string().min(1),
  offerId: z.uuid(),
  offerRevision: z.int().positive(),
  mode: invitationModeSchema,
  giftMonths: z.int().positive().nullable(),
  /** Выдача и отзыв возвращают приглашение без заметки: её показывает только список. */
  note: z.string().nullable().optional(),
  state: invitationStateSchema,
  issuedAt: moment,
  expiresAt: moment,
  claimedAt: moment.nullable(),
  redeemedAt: moment.nullable(),
  revokedAt: moment.nullable(),
  accountId: z.uuid().nullable(),
  revision: z.int().nonnegative(),
  /** Готовая ссылка на бота; без имени бота её нет, и владелец отправляет параметр запуска. */
  link: z.string().min(1).nullable(),
});

export const invitationOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("invitation"),
    value: invitationSchema,
  }),
});
/**
 * Итог отзыва. Журнал владельца не хранит код и ссылку приглашения, поэтому повтор отзыва после
 * потерянного ответа возвращает итог без них.
 */
export const revokedInvitationOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("invitation"),
    value: invitationSchema.partial({
      code: true,
      startParameter: true,
      link: true,
    }),
  }),
});
export type RevokedInvitationOutcome = z.infer<
  typeof revokedInvitationOutcomeSchema
>;
export const invitationsOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("invitations"),
    items: z.array(invitationSchema),
    nextCursor: z.uuid().nullable(),
  }),
});

export type InvitationState = z.infer<typeof invitationStateSchema>;
export type InvitationMode = z.infer<typeof invitationModeSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type InvitationOutcome = z.infer<typeof invitationOutcomeSchema>;
export type InvitationsOutcome = z.infer<typeof invitationsOutcomeSchema>;
export type IssueInvitationInput = z.infer<typeof issueInvitationInputSchema>;
export type RevokeInvitationInput = z.infer<typeof revokeInvitationInputSchema>;
export type ListInvitationsInput = z.infer<typeof listInvitationsInputSchema>;

/** Фильтр списка: все приглашения или одно состояние. */
export type InvitationStateFilter = InvitationState | "all";

export const invitationStateFilters: readonly {
  readonly value: InvitationStateFilter;
  readonly label: string;
}[] = [
  { value: "all", label: "Все" },
  { value: "issued", label: "Выдано" },
  { value: "claimed", label: "Открыто" },
  { value: "redeemed", label: "Использовано" },
  { value: "expired", label: "Сгорело" },
  { value: "revoked", label: "Отозвано" },
];

/** Использованное приглашение называется по своему результату: оплата открыта или доступ подарен. */
export function invitationStateLabel(
  state: InvitationState,
  mode: InvitationMode,
): string {
  switch (state) {
    case "issued":
      return "Выдано";
    case "claimed":
      return "Открыто";
    case "redeemed":
      return mode === "gift" ? "Подарено" : "Оплата открыта";
    case "expired":
      return "Сгорело";
    case "revoked":
      return "Отозвано";
  }
}

export function invitationModeLabel(mode: InvitationMode): string {
  return mode === "gift" ? "Подарок" : "Оплата";
}

/** Срок есть только у подарка: оплата берёт срок из выбранного варианта оплаты. */
export function invitationTermLabel(
  invitation: Pick<Invitation, "mode" | "giftMonths">,
): string | null {
  if (invitation.mode !== "gift") return null;
  return invitation.giftMonths === null
    ? "Бессрочно"
    : `${String(invitation.giftMonths)} мес.`;
}

/** Что отправить человеку: ссылку на бота, а без неё — параметр запуска для ручной ссылки. */
export function invitationShareText(
  invitation: Pick<Invitation, "link" | "startParameter">,
): string {
  return invitation.link ?? invitation.startParameter;
}

/** Отозвать можно только неиспользованное приглашение, которое ещё не сгорело. */
export function canRevokeInvitation(
  invitation: Pick<Invitation, "state">,
): boolean {
  return invitation.state === "issued" || invitation.state === "claimed";
}

export interface InvitationOfferChoice {
  readonly id: string;
  readonly name: string;
}

/**
 * Каталог владельца приходит снимками вариантов оплаты: у одного предложения их несколько.
 * Названия нужны списку и для архивных предложений, а выбор формы — только для действующих.
 */
export function invitationOfferNames(
  offers: readonly PriceSnapshot[],
): ReadonlyMap<string, string> {
  return new Map(
    offers.map((snapshot) => [snapshot.offer.id, snapshot.offer.name]),
  );
}

export function invitationOfferChoices(
  offers: readonly PriceSnapshot[],
): readonly InvitationOfferChoice[] {
  const choices = new Map<string, InvitationOfferChoice>();
  for (const { offer } of offers) {
    if (offer.archived || choices.has(offer.id)) continue;
    choices.set(offer.id, { id: offer.id, name: offer.name });
  }
  return [...choices.values()];
}
