import type { Route } from "next";
import { z } from "zod";

import { attemptStateSchema } from "@/entities/subscription";
import { formatMoscowDate, formatRubles } from "@/shared/lib/moscow-format";
import {
  authoringProductEditorHref,
  authoringMaterialsRootHref,
  withAuthoringReturnHref,
} from "@/shared/routing/authoring";
import { internalRoute } from "@/shared/routing/internal-route";

/**
 * Общий поиск админки (#1717): одна строка запроса, ответ сервера по группам. Каждая группа
 * приходит только к аккаунту с правом на неё; аккаунт без права ни на одну группу получает отказ.
 *
 * Как добавить группу (#1721 «Люди»): вариант в `searchGroupSchema` с тем же
 * `kind`, что у группы сервера, и запись в `searchGroupPresentation`. Порядок групп задаёт сервер.
 */
export const authoringSearchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .transform((value) => value.replace(/\s+/gu, " "));

const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);

const productHitSchema = z
  .object({ archived: z.boolean(), id: z.uuid(), name: z.string() })
  .strict();
const materialHitSchema = z
  .object({
    id: z.uuid(),
    publicationState: publicationStateSchema,
    title: z.string().nullable(),
    topic: z.string().nullable(),
  })
  .strict();

/** Платёж без человека и адреса: номер заказа, продукт, сумма, состояние банка и время. */
const paymentHitSchema = z
  .object({
    amountKopecks: z.int().positive(),
    createdAt: z.iso.datetime(),
    productName: z.string(),
    purchaseRef: z.uuid(),
    state: attemptStateSchema,
  })
  .strict();

const unavailableGroupSchema = z
  .object({
    kind: z.enum(["products", "materials", "payments"]),
    state: z.literal("unavailable"),
  })
  .strict();

export const searchGroupSchema = z.union([
  z
    .object({
      items: z.array(productHitSchema),
      kind: z.literal("products"),
      state: z.literal("ready"),
    })
    .strict(),
  z
    .object({
      items: z.array(materialHitSchema),
      kind: z.literal("materials"),
      state: z.literal("ready"),
    })
    .strict(),
  z
    .object({
      items: z.array(paymentHitSchema),
      kind: z.literal("payments"),
      personSearch: z.enum(["available", "name_unavailable", "unavailable"]),
      state: z.literal("ready"),
    })
    .strict(),
  unavailableGroupSchema,
]);

export const searchResponseSchema = z
  .object({ groups: z.array(searchGroupSchema) })
  .strict();

export type AuthoringSearchGroup = z.infer<typeof searchGroupSchema>;
export type AuthoringSearchGroupKind = AuthoringSearchGroup["kind"];

export type AuthoringSearchState =
  | { readonly kind: "ready"; readonly groups: readonly AuthoringSearchGroup[] }
  | { readonly kind: "signed_out" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable"; readonly reference: string };

export const authoringSearchStateSchema: z.ZodType<AuthoringSearchState> =
  z.union([
    z
      .object({ groups: z.array(searchGroupSchema), kind: z.literal("ready") })
      .strict(),
    z.object({ kind: z.literal("signed_out") }).strict(),
    z.object({ kind: z.literal("forbidden") }).strict(),
    z
      .object({ kind: z.literal("unavailable"), reference: z.string() })
      .strict(),
  ]);

/** Одна строка результата в окне поиска: что открыть и как его назвать. */
export interface AuthoringSearchEntry {
  readonly id: string;
  readonly href: Route;
  readonly title: string;
  /** Подстрока контекста: тема материала, архив продукта, сумма и дата платежа. */
  readonly caption: string | null;
}

const materialStateLabels = {
  draft: "Черновик",
  published: "Опубликован",
  unpublished: "Снят с публикации",
} as const;

/** Подпись и строки каждой группы; новая группа добавляет сюда свою запись. */
export const searchGroupPresentation: {
  readonly [Kind in AuthoringSearchGroupKind]: {
    readonly heading: string;
    readonly entries: (
      group: Extract<AuthoringSearchGroup, { kind: Kind; state: "ready" }>,
    ) => readonly AuthoringSearchEntry[];
  };
} = {
  products: {
    heading: "Продукты",
    entries: (group) =>
      group.items.map((item) => ({
        id: `products-${item.id}`,
        href: authoringProductEditorHref(item.id),
        title: item.name,
        caption: item.archived ? "Архив" : null,
      })),
  },
  materials: {
    heading: "Материалы",
    entries: (group) =>
      group.items.map((item) => ({
        id: `materials-${item.id}`,
        href: withAuthoringReturnHref(
          `/authoring/materials/${item.id}`,
          authoringMaterialsRootHref,
        ),
        title: item.title ?? "Черновик без названия",
        caption: [item.topic, materialStateLabels[item.publicationState]]
          .filter((part) => part !== null)
          .join(" · "),
      })),
  },
  payments: {
    heading: "Платежи",
    entries: (group) =>
      group.items.map((item) => ({
        id: `payments-${item.purchaseRef}`,
        href: internalRoute(`/authoring/sales/payments/${item.purchaseRef}`),
        title: item.productName,
        caption: `${formatRubles(item.amountKopecks)} · ${formatMoscowDate(item.createdAt)}`,
      })),
  },
};

/**
 * Чего группа сейчас не искала, чтобы пустой список не выглядел ответом. Платежи по номеру заказа
 * и сумме ищутся всегда; по человеку сервер мог не искать.
 */
export function searchGroupNote(group: AuthoringSearchGroup): string | null {
  if (group.state !== "ready" || group.kind !== "payments") return null;
  switch (group.personSearch) {
    case "available":
      return null;
    case "name_unavailable":
      return "Поиск по имени временно недоступен. Найдите платежи человека по email или ID.";
    case "unavailable":
      return "Поиск по человеку временно недоступен. Номер заказа и сумма ищутся.";
  }
}

/** Строки группы, готовой к показу, в порядке сервера. */
export function searchGroupEntries(
  group: AuthoringSearchGroup,
): readonly AuthoringSearchEntry[] {
  if (group.state !== "ready") return [];
  switch (group.kind) {
    case "products":
      return searchGroupPresentation.products.entries(group);
    case "materials":
      return searchGroupPresentation.materials.entries(group);
    case "payments":
      return searchGroupPresentation.payments.entries(group);
  }
}

export function authoringSearchQueryKey(query: string) {
  return ["authoring", "search", query] as const;
}
