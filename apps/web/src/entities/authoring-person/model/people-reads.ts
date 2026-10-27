import { z } from "zod";

import { personIdentitySchema, type PersonIdentity } from "./person-identity";

/** Самый длинный запрос поиска людей после обрезки пробелов; так же считает сервер. */
export const PEOPLE_SEARCH_QUERY_MAX_CHARACTERS = 160;
/** Больше людей поиск не возвращает. */
export const PEOPLE_SEARCH_LIMIT = 20;
/** Больше аккаунтов одно чтение подписей не принимает. */
export const PEOPLE_IDENTITIES_LIMIT = 100;

export const peopleSearchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(PEOPLE_SEARCH_QUERY_MAX_CHARACTERS)
  .transform((value) => value.replace(/\s+/gu, " "));

export const peopleSearchLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(PEOPLE_SEARCH_LIMIT);

export const peopleIdentitiesQuerySchema = z
  .array(z.uuid())
  .min(1)
  .max(PEOPLE_IDENTITIES_LIMIT);

/**
 * `unavailable`: запрос был именем или @username, а Telegram не ответил. Пустой список тогда не
 * ответ, и экран говорит «поиск по имени временно недоступен», а не «никого не нашли».
 */
export type NameSearchState = "available" | "unavailable";

type ReadFailure =
  | { readonly kind: "signed_out" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable"; readonly reference: string };

export type PeopleSearchState =
  | {
      readonly kind: "ready";
      readonly items: readonly PersonIdentity[];
      readonly nameSearch: NameSearchState;
    }
  | ReadFailure;

export type PeopleIdentitiesState =
  | { readonly kind: "ready"; readonly items: readonly PersonIdentity[] }
  | ReadFailure;

const failureSchemas = [
  z.object({ kind: z.literal("signed_out") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("unavailable"), reference: z.string() }).strict(),
] as const;

export const peopleSearchResponseSchema = z
  .object({
    items: z.array(personIdentitySchema).max(PEOPLE_SEARCH_LIMIT),
    nameSearch: z.enum(["available", "unavailable"]),
  })
  .strict();

export const peopleIdentitiesResponseSchema = z
  .object({
    items: z.array(personIdentitySchema).max(PEOPLE_IDENTITIES_LIMIT),
  })
  .strict();

export const peopleSearchStateSchema: z.ZodType<PeopleSearchState> = z.union([
  peopleSearchResponseSchema.extend({ kind: z.literal("ready") }),
  ...failureSchemas,
]);

export const peopleIdentitiesStateSchema: z.ZodType<PeopleIdentitiesState> =
  z.union([
    peopleIdentitiesResponseSchema.extend({ kind: z.literal("ready") }),
    ...failureSchemas,
  ]);

/** Ключ поиска людей; запрос в ключе уже нормализован. */
export function peopleSearchQueryKey(query: string, limit: number) {
  return ["authoring", "people", "search", query, limit] as const;
}

/** Ключ подписей набора людей: набор отсортирован, порядок колонки его не меняет. */
export function peopleIdentitiesQueryKey(accountIds: readonly string[]) {
  return [
    "authoring",
    "people",
    "identities",
    [...new Set(accountIds.map((id) => id.toLowerCase()))].sort(),
  ] as const;
}

/** Все чтения людей: запись доступа или контакта сбрасывает их разом. */
export const peopleQueryKey = ["authoring", "people"] as const;
