import { z } from "zod";

import {
  accessCapabilitySchema,
  formatMonths,
  offerEligibilitySchema,
  paymentMode,
  type BillingOffer,
  type OfferEligibility,
  type PriceSnapshot,
} from "@/entities/subscription";

import type { SaveOfferInput } from "./admin-operations";

/** Раздел «Доступ» (#910): люди с основаниями доступа и сводка. */
export const accessSourceSchema = z.enum([
  "platform_payment",
  "invitation",
  "course",
  "manual",
  "tribute",
  "one_time_purchase",
]);
export const groundStateSchema = z.enum([
  "scheduled",
  "active",
  "ended",
  "revoked",
]);
export const holderStateSchema = z.enum(["active", "expiring", "ended"]);
/** Страница списка людей: сервер по умолчанию отдаёт столько же. */
export const peoplePageSize = 50;

const operationId = z.uuid();
const moment = z.iso.datetime({ offset: true });
export const listPeopleInputSchema = z.strictObject({
  operationId,
  offerId: z.uuid().optional(),
  source: accessSourceSchema.optional(),
  state: holderStateSchema.optional(),
  cursor: z.uuid().optional(),
  limit: z.int().min(1).max(100),
});
export const accessSummaryInputSchema = z.strictObject({ operationId });

export const personGroundSchema = z.object({
  kind: z.enum(["enrollment", "grant"]),
  id: z.uuid(),
  revision: z.int().positive(),
  source: accessSourceSchema,
  offer: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  capabilities: z.array(accessCapabilitySchema),
  purchaseRef: z.uuid().nullable(),
  startsAt: moment,
  endsAt: moment.nullable(),
  revokedAt: moment.nullable(),
  endPolicy: z
    .enum(["fixed", "confirmed_external", "temporary_membership"])
    .nullable(),
  state: groundStateSchema,
});
export const accessHolderSchema = z.object({
  accountId: z.uuid(),
  telegramIdentityRef: z.string().nullable(),
  grounds: z.array(personGroundSchema),
});
export const peopleOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("people"),
    items: z.array(accessHolderSchema),
    nextCursor: z.uuid().nullable(),
  }),
});

const count = z.int().nonnegative();
export const accessSummarySchema = z.object({
  asOf: moment,
  active: z.array(
    z.object({
      offerId: z.uuid(),
      name: z.string(),
      paid: count,
      gift: count,
      course: count,
    }),
  ),
  invitations: z.object({
    issued: count,
    opened: count,
    purchaseOpened: count,
    paid: count,
    expired: count,
    revoked: count,
  }),
  attention: z.array(
    z.object({
      accountId: z.uuid(),
      reason: z.enum(["ending", "payment_failed"]),
      source: accessSourceSchema.nullable(),
      offerId: z.uuid().nullable(),
      title: z.string(),
      at: moment,
    }),
  ),
  revenue: z.array(
    z.object({
      month: z.string().min(7).max(7),
      offerId: z.uuid(),
      name: z.string(),
      payments: count,
      revenueKopecks: count,
      refunds: count,
      refundedKopecks: count,
    }),
  ),
});
export const accessSummaryOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("accessSummary"),
    value: accessSummarySchema,
  }),
});

export type AccessSource = z.infer<typeof accessSourceSchema>;
export type GroundState = z.infer<typeof groundStateSchema>;
export type HolderState = z.infer<typeof holderStateSchema>;
export type PersonGround = z.infer<typeof personGroundSchema>;
export type AccessHolder = z.infer<typeof accessHolderSchema>;
export type AccessSummary = z.infer<typeof accessSummarySchema>;
export type ListPeopleInput = z.infer<typeof listPeopleInputSchema>;
export type AccessSummaryInput = z.infer<typeof accessSummaryInputSchema>;
export type PeopleOutcome = z.infer<typeof peopleOutcomeSchema>;
export type AccessSummaryOutcome = z.infer<typeof accessSummaryOutcomeSchema>;

/** Фильтры списка людей; пустое значение — без фильтра. */
export interface PeopleFilters {
  readonly offerId: string | null;
  readonly source: AccessSource | null;
  readonly state: HolderState | null;
}
export const noPeopleFilters: PeopleFilters = {
  offerId: null,
  source: null,
  state: null,
};

export function accessSourceLabel(source: AccessSource): string {
  switch (source) {
    case "platform_payment":
      return "Оплата подписки";
    case "invitation":
      return "Подарок по приглашению";
    case "course":
      return "Курс";
    case "manual":
      return "Решение владельца";
    case "tribute":
      return "Tribute";
    case "one_time_purchase":
      return "Разовая покупка";
  }
}
export const accessSources: readonly AccessSource[] =
  accessSourceSchema.options;

export function holderStateLabel(state: HolderState): string {
  switch (state) {
    case "active":
      return "Действует";
    case "expiring":
      return "Кончается за 7 дней";
    case "ended":
      return "Закончился за 30 дней";
  }
}
export const holderStates: readonly HolderState[] = holderStateSchema.options;

export function groundStateLabel(state: GroundState): string {
  switch (state) {
    case "scheduled":
      return "Начнётся";
    case "active":
      return "Действует";
    case "ended":
      return "Закончился";
    case "revoked":
      return "Отозван";
  }
}

/** Что основание называет: Offer, а у ручного права без Offer — его права. */
export function groundTitle(ground: PersonGround): string {
  return ground.offer?.name ?? ground.capabilities.join(", ");
}

export interface GroundActions {
  readonly extend: boolean;
  readonly revoke: boolean;
  readonly restore: boolean;
}
/**
 * Какие существующие команды применимы к основанию. Назначение меняет `enrollments.change`: у
 * курса нет срока, поэтому его только отзывают, а назначение из платежа принадлежит Billing и
 * меняется отменой продления и возвратом. Ручное право меняют `grants.extend` и `grants.revoke`.
 * Разовую покупку меняет только возврат, поэтому действий у неё нет.
 */
export function groundActions(ground: PersonGround): GroundActions {
  const live = ground.state === "active" || ground.state === "scheduled";
  if (
    ground.source === "platform_payment" ||
    ground.source === "one_time_purchase"
  )
    return { extend: false, revoke: false, restore: false };
  if (ground.kind === "enrollment")
    return {
      extend:
        ground.source !== "course" &&
        ground.source !== "manual" &&
        ground.state !== "revoked",
      revoke: live,
      restore: ground.state === "revoked",
    };
  return { extend: ground.state !== "revoked", revoke: live, restore: false };
}

/** Назначение Tribute держит конечный срок: продлить его «бессрочно» сервер не даёт. */
export function groundNeedsEnd(ground: PersonGround): boolean {
  return ground.source === "tribute";
}

const dayMs = 24 * 60 * 60 * 1000;
/** Москва живёт без перехода на летнее время: сутки по Москве начинаются в 00:00 UTC+3. */
const moscowOffset = "+03:00";
const moscowOffsetMs = 3 * 60 * 60 * 1000;

/** Доступ «до 30 апреля» включает этот день: конец — начало следующих суток по Москве. */
export function endOfMoscowDay(date: string): string {
  return new Date(
    new Date(`${date}T00:00:00${moscowOffset}`).getTime() + dayMs,
  ).toISOString();
}
/** Последний день по Москве, который ещё входит в доступ с концом `endsAt`. */
export function lastMoscowDay(endsAt: string): string {
  return new Date(new Date(endsAt).getTime() + moscowOffsetMs - 1)
    .toISOString()
    .slice(0, 10);
}

export interface TariffOption {
  readonly id: string;
  readonly mode: "subscription" | "one_time";
  readonly months: number;
  readonly priceKopecks: number;
}
export interface TariffRow {
  readonly offer: BillingOffer;
  readonly options: readonly TariffOption[];
}
/**
 * Каталог владельца приходит снимками вариантов оплаты: Offer повторяется в каждом. Тарифы
 * показывают действующие Offer по одному с их действующими вариантами.
 */
export function tariffRows(
  offers: readonly PriceSnapshot[],
): readonly TariffRow[] {
  const rows = new Map<
    string,
    { offer: BillingOffer; options: TariffOption[] }
  >();
  for (const snapshot of offers) {
    if (snapshot.offer.archived) continue;
    const row = rows.get(snapshot.offer.id) ?? {
      offer: snapshot.offer,
      options: [],
    };
    if (!snapshot.paymentOption.archived)
      row.options.push({
        id: snapshot.paymentOption.id,
        mode: paymentMode(snapshot),
        months: snapshot.paymentOption.months,
        priceKopecks: snapshot.paymentOption.priceKopecks,
      });
    rows.set(snapshot.offer.id, row);
  }
  return [...rows.values()];
}

export function tariffOptionLabel(option: TariffOption): string {
  return option.mode === "one_time"
    ? "разово"
    : `подписка на ${formatMonths(option.months)}`;
}

export function eligibilityLabel(eligibility: OfferEligibility): string {
  switch (eligibility) {
    case "everyone":
      return "Всем";
    case "invitation_only":
      return "Только по приглашению";
    case "former_tribute_subscribers":
      return "Прежним подписчикам Tribute";
  }
}
/** Владелец выбирает из двух; прежний допуск Tribute показывается, пока он задан у Offer. */
export function eligibilityChoices(
  current: OfferEligibility,
): readonly OfferEligibility[] {
  return current === "former_tribute_subscribers"
    ? ["everyone", "invitation_only", current]
    : ["everyone", "invitation_only"];
}
export function parseEligibility(value: string): OfferEligibility | null {
  const parsed = offerEligibilitySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Сохранение допуска переписывает Offer целиком: состав, сроки и признак назначения берутся из
 * текущей редакции, меняется только допуск.
 */
export function eligibilitySave(
  offer: BillingOffer,
  eligibility: OfferEligibility,
): Omit<SaveOfferInput, "operationId"> {
  return {
    expectedRevision: offer.revision,
    value: {
      id: offer.id,
      name: offer.name,
      benefits: [...offer.benefits],
      eligibility,
      ...(offer.availableForAssignment === undefined
        ? {}
        : { availableForAssignment: offer.availableForAssignment }),
      ...(offer.contentScope === undefined
        ? {}
        : { contentScope: offer.contentScope }),
      ...(offer.benefitPeriods === undefined
        ? {}
        : { benefitPeriods: [...offer.benefitPeriods] }),
    },
  };
}

const monthFormat = new Intl.DateTimeFormat("ru-RU", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
/** Месяц сводки `YYYY-MM` словами: «март 2030 г.». */
export function summaryMonthLabel(month: string): string {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`));
}
