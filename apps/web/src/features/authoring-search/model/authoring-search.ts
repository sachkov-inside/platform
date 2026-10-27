import type { Route } from "next";
import { z } from "zod";

import { personIdentitySchema, personLabel } from "@/entities/authoring-person";
import {
  authoringPersonHref,
  authoringProductEditorHref,
  authoringMaterialsRootHref,
  withAuthoringReturnHref,
} from "@/shared/routing/authoring";

/**
 * Общий поиск админки (#1717): одна строка запроса, ответ сервера по группам. Каждая группа
 * приходит только к аккаунту с правом на неё; аккаунт без права ни на одну группу получает отказ.
 *
 * Как добавить группу (#1718 «Платежи»): вариант в `searchGroupSchema` с тем же `kind`, что у
 * группы сервера, и запись в `searchGroupPresentation`. Порядок групп задаёт сервер: люди,
 * продукты, материалы. Группа «Люди» (#1721) приходит только аккаунту с `billing:manage`.
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

const unavailableGroupSchema = z
  .object({
    kind: z.enum(["people", "products", "materials"]),
    state: z.literal("unavailable"),
  })
  .strict();

export const searchGroupSchema = z.union([
  z
    .object({
      items: z.array(personIdentitySchema),
      kind: z.literal("people"),
      /**
       * Поиск по имени и @username не ответил (Telegram недоступен). Поиск по email и ID при этом
       * работает: `items` содержат только его совпадения, если они есть.
       */
      partial: z.boolean(),
      state: z.literal("ready"),
    })
    .strict(),
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
  /** Подстрока контекста: тема материала, архив продукта. */
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
  people: {
    heading: "Люди",
    entries: (group) =>
      group.items.map((item) => {
        const label = personLabel(item);
        return {
          id: `people-${item.accountId}`,
          href: authoringPersonHref(item.accountId),
          title: label.title ?? label.missing,
          caption:
            label.context.length === 0 ? null : label.context.join(" · "),
        };
      }),
  },
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
};

/** Строки группы, готовой к показу, в порядке сервера. */
export function searchGroupEntries(
  group: AuthoringSearchGroup,
): readonly AuthoringSearchEntry[] {
  if (group.state !== "ready") return [];
  switch (group.kind) {
    case "people":
      return searchGroupPresentation.people.entries(group);
    case "products":
      return searchGroupPresentation.products.entries(group);
    case "materials":
      return searchGroupPresentation.materials.entries(group);
  }
}

/** Пояснение к группе: у «Людей» без поиска по имени работают только email и ID. */
export function searchGroupNote(group: AuthoringSearchGroup): string | null {
  return group.kind === "people" && group.state === "ready" && group.partial
    ? "Поиск по имени и @username временно недоступен; поиск по email и ID работает."
    : null;
}

export function authoringSearchQueryKey(query: string) {
  return ["authoring", "search", query] as const;
}
