import { z } from "zod";

import type { PromotionListItem, PromotionValue } from "./promotion-operations";

const MOSCOW_OFFSET = "+03:00";
const MOSCOW_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
const dateSchema = z.iso.date();
const wholePattern = /^\d+$/u;

/** Поля формы скидки, как их видит владелец: даты днями по Москве, числа текстом поля. */
export interface PromotionFormValues {
  readonly name: string;
  readonly code: string;
  readonly percentText: string;
  /** Первый день действия, «YYYY-MM-DD» по Москве. */
  readonly startDate: string;
  /** Последний день действия включительно, «YYYY-MM-DD» по Москве. */
  readonly endDate: string;
  /** Пустой список значит «все продукты». */
  readonly productIds: readonly string[];
  readonly usageLimitText: string;
}

export type PromotionFormField =
  | "name"
  | "code"
  | "percent"
  | "startDate"
  | "endDate"
  | "productIds"
  | "usageLimit";

export type PromotionFormErrors = Partial<Record<PromotionFormField, string>>;

/** Редактируемая скидка: её ключ, редакция из списка и сохранённые моменты периода. */
export interface PromotionOrigin {
  readonly id: string;
  readonly revision: number;
  readonly startsAt: string;
  readonly endsAt: string;
}

function moscowDay(instant: number): string {
  return new Date(instant + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

function moscowMidnight(date: string): string {
  return `${date}T00:00:00${MOSCOW_OFFSET}`;
}

function nextDay(date: string): string {
  return moscowDay(Date.parse(moscowMidnight(date)) + DAY_MS);
}

/** Первый день периода по Москве. */
export function promotionStartDate(startsAt: string): string {
  return moscowDay(Date.parse(startsAt));
}

/** Последний день периода по Москве: `endsAt` уже не входит в период. */
export function promotionEndDate(endsAt: string): string {
  return moscowDay(Date.parse(endsAt) - 1);
}

export function emptyPromotionForm(
  productIds: readonly string[] = [],
): PromotionFormValues {
  return {
    name: "",
    code: "",
    percentText: "",
    startDate: "",
    endDate: "",
    productIds,
    usageLimitText: "",
  };
}

/** Форма изменения из строки списка: та же редакция, те же дни периода. */
export function promotionFormFromItem(
  item: PromotionListItem,
): PromotionFormValues {
  return {
    name: item.name,
    code: item.code ?? "",
    percentText: String(item.percent),
    startDate: promotionStartDate(item.startsAt),
    endDate: promotionEndDate(item.endsAt),
    productIds: item.productIds,
    usageLimitText: item.usageLimit === null ? "" : String(item.usageLimit),
  };
}

export type PromotionCommand =
  | {
      readonly ok: true;
      readonly value: PromotionValue;
      readonly expectedRevision?: number;
    }
  | { readonly ok: false; readonly errors: PromotionFormErrors };

/**
 * Поля формы → значение команды `promotions.save`. Дни периода становятся моментами по Москве:
 * начало в полночь первого дня, конец в полночь после последнего. Неизменённый день периода
 * сохраняет прежний момент скидки, даже если он стоял не в полночь.
 */
export function promotionCommand(
  values: PromotionFormValues,
  id: string,
  origin?: PromotionOrigin,
): PromotionCommand {
  const errors: PromotionFormErrors = {};
  const name = values.name.trim();
  if (name === "") errors.name = "Введите название скидки";
  else if (name.length > 200) errors.name = "Название не длиннее 200 знаков";
  const code = values.code.trim();
  if (code.length > 100) errors.code = "Промокод не длиннее 100 знаков";
  const percentText = values.percentText.trim();
  const percent = wholePattern.test(percentText) ? Number(percentText) : NaN;
  if (!(Number.isInteger(percent) && percent >= 1 && percent <= 100))
    errors.percent = "Скидка должна быть целым числом от 1 до 100 %";
  const startValid = dateSchema.safeParse(values.startDate).success;
  const endValid = dateSchema.safeParse(values.endDate).success;
  if (!startValid) errors.startDate = "Укажите первый день скидки";
  if (!endValid) errors.endDate = "Укажите последний день скидки";
  else if (startValid && values.endDate < values.startDate)
    errors.endDate = "Последний день не может быть раньше первого";
  if (values.productIds.length > 100)
    errors.productIds = "Выберите не больше 100 продуктов";
  const limitText = values.usageLimitText.trim();
  const usageLimit =
    limitText === ""
      ? null
      : wholePattern.test(limitText) && Number(limitText) >= 1
        ? Number(limitText)
        : NaN;
  if (usageLimit !== null && !Number.isSafeInteger(usageLimit))
    errors.usageLimit = "Лимит должен быть целым числом от 1 или пустым";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const startsAt =
    origin !== undefined &&
    promotionStartDate(origin.startsAt) === values.startDate
      ? origin.startsAt
      : moscowMidnight(values.startDate);
  const endsAt =
    origin !== undefined && promotionEndDate(origin.endsAt) === values.endDate
      ? origin.endsAt
      : moscowMidnight(nextDay(values.endDate));
  return {
    ok: true,
    value: {
      id,
      name,
      percent,
      code: code === "" ? null : code,
      startsAt,
      endsAt,
      productIds: [...new Set(values.productIds)],
      usageLimit,
    },
    ...(origin === undefined ? {} : { expectedRevision: origin.revision }),
  };
}
