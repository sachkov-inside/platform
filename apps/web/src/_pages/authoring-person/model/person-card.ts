import { z } from "zod";

import {
  accessOriginSchema,
  peopleAccessReadsQueryKey,
  productAccessStateSchema,
} from "@/entities/authoring-person";

/**
 * Карточка человека (#1721), `GET /authoring/people/{accountId}`. Каждый блок отвечает сам:
 * `ready`, `unavailable` (его владелец не ответил, остальные блоки целы) или `forbidden` (только
 * сдачи, которым нужно ещё и право на материалы). Схема одна для тела backend и для ответа BFF.
 */
const instant = z.iso.datetime({ offset: true });
const unavailableSchema = z
  .object({ state: z.literal("unavailable") })
  .strict();

export const personHeaderSchema = z
  .object({
    accountId: z.uuid(),
    displayName: z.string().nullable(),
    username: z.string().nullable(),
    email: z.string().nullable(),
    contactsState: z.enum(["complete", "partial"]),
    registeredAt: instant,
    /** Адрес Telegram из провайдера; ссылкой становится только https (`telegramHref`). */
    telegramUrl: z.string().nullable(),
  })
  .strict();

const actorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("system") }).strict(),
  z
    .object({
      kind: z.literal("person"),
      accountId: z.uuid(),
      label: z.string().nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]);

export const accessHistoryKindSchema = z.enum([
  "purchase",
  "activation",
  "manual_issue",
  "transfer",
  "revoke",
  "restore",
  "migrate",
  "other",
]);

const historyEntrySchema = z
  .object({
    kind: accessHistoryKindSchema,
    at: instant,
    actor: actorSchema,
    reason: z.string().nullable(),
  })
  .strict();

const productSchema = z
  .object({
    productId: z.uuid(),
    name: z.string(),
    access: productAccessStateSchema,
    revision: z.int().positive(),
    firstIssuedAt: instant.nullable(),
    origin: accessOriginSchema,
    history: z.array(historyEntrySchema),
  })
  .strict();

const paymentSchema = z
  .object({
    paymentId: z.string().min(1),
    productId: z.uuid().nullable(),
    productName: z.string().nullable(),
    amountKopecks: z.int(),
    state: z.string(),
    createdAt: instant,
    paymentLinkId: z.string().min(1).nullable(),
  })
  .strict();

const learningSchema = z
  .object({
    productId: z.uuid(),
    name: z.string(),
    startedAt: instant.nullable(),
    progress: z.union([
      z
        .object({
          state: z.literal("measured"),
          read: z.int().nonnegative(),
          total: z.int().nonnegative(),
          lastActivityAt: instant.nullable(),
        })
        .strict(),
      unavailableSchema,
    ]),
  })
  .strict();

const submissionSchema = z
  .object({
    productId: z.uuid(),
    count: z.int().nonnegative(),
    lastSubmittedAt: instant,
    lastTaskCode: z.string().nullable(),
  })
  .strict();

const telegramSchema = z
  .object({
    state: z.literal("ready"),
    link: z.enum(["linked", "not_linked"]),
    membership: z.enum(["member", "not_member", "unknown"]),
    restriction: z.enum(["none", "moderation", "external_unknown", "unknown"]),
    marketing: z.enum(["enabled", "stopped", "unknown"]),
    observedAt: instant.nullable(),
  })
  .strict();

const waitlistSchema = z
  .object({
    productId: z.uuid(),
    productName: z.string().nullable(),
    intakeName: z.string(),
    active: z.boolean(),
    joinedAt: instant,
  })
  .strict();

function readyItems<Item extends z.ZodType>(item: Item) {
  return z.object({ state: z.literal("ready"), items: z.array(item) }).strict();
}

export const personCardSchema = z
  .object({
    person: personHeaderSchema,
    products: z.union([readyItems(productSchema), unavailableSchema]),
    payments: z.union([readyItems(paymentSchema), unavailableSchema]),
    learning: z.union([readyItems(learningSchema), unavailableSchema]),
    submissions: z.union([
      readyItems(submissionSchema),
      z.object({ state: z.literal("forbidden") }).strict(),
      unavailableSchema,
    ]),
    telegram: z.union([telegramSchema, unavailableSchema]),
    waitlists: z.union([readyItems(waitlistSchema), unavailableSchema]),
  })
  .strict();

export type PersonCard = z.infer<typeof personCardSchema>;
export type PersonCardProduct = Extract<
  PersonCard["products"],
  { readonly state: "ready" }
>["items"][number];
export type PersonCardHistoryEntry = PersonCardProduct["history"][number];
export type PersonCardPayment = Extract<
  PersonCard["payments"],
  { readonly state: "ready" }
>["items"][number];
export type PersonCardLearning = Extract<
  PersonCard["learning"],
  { readonly state: "ready" }
>["items"][number];
export type PersonCardSubmission = Extract<
  PersonCard["submissions"],
  { readonly state: "ready" }
>["items"][number];
export type PersonCardTelegram = PersonCard["telegram"];
export type PersonCardWaitlist = Extract<
  PersonCard["waitlists"],
  { readonly state: "ready" }
>["items"][number];

export type PersonCardState =
  | { readonly kind: "ready"; readonly card: PersonCard }
  | { readonly kind: "not_found" }
  | { readonly kind: "signed_out" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable"; readonly reference: string };

export const personCardStateSchema: z.ZodType<PersonCardState> = z.union([
  z.object({ kind: z.literal("ready"), card: personCardSchema }).strict(),
  z.object({ kind: z.literal("not_found") }).strict(),
  z.object({ kind: z.literal("signed_out") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("unavailable"), reference: z.string() }).strict(),
]);

/** Ключ карточки под общим префиксом чтений доступа: запись доступа сбрасывает и его. */
export function personCardQueryKey(accountId: string) {
  return [
    ...peopleAccessReadsQueryKey,
    "card",
    accountId.toLowerCase(),
  ] as const;
}
