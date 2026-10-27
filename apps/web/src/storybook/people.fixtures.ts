import type {
  PersonCard,
  PersonCardState,
} from "@/_pages/authoring-person/model/person-card";
import type {
  PeopleListState,
  PersonRow,
} from "@/_pages/authoring-people/model/people-list";
import type { AccessProduct } from "@/features/product-access-actions";

import { z } from "zod";

import type { MutationFetch } from "./mutation-mock";

const commandSchema = z.object({ productId: z.string() }).loose();

/**
 * Люди админки для stories (#1721): строки списка, карточки и ответы BFF действий с доступом.
 * Данные детерминированы: без случайности и текущих часов, с настоящими длинами русских имён.
 */

export const storyProducts = [
  {
    productId: "96000000-0000-4000-8000-000000000301",
    name: "AI Engineering: агенты в работе",
    archived: false,
  },
  {
    productId: "96000000-0000-4000-8000-000000000302",
    name: "Архитектура приложения и проектирование распределённых систем",
    archived: false,
  },
  {
    productId: "96000000-0000-4000-8000-000000000303",
    name: "Инженерная практика",
    archived: false,
  },
  {
    productId: "96000000-0000-4000-8000-000000000304",
    name: "Агенты для команды (поток 2025)",
    archived: true,
  },
] as const satisfies readonly AccessProduct[];

const [ai, architecture, practice] = storyProducts;

export const storyAnnaId = "96000000-0000-4000-8000-000000000401";

const names = [
  "Анна Петрова",
  "Константин Константинопольский-Задунайский",
  "Мария Соколова",
  "Дмитрий Иванов",
  "Елена Кузнецова",
  "Алексей Смирнов",
] as const;

function accountId(index: number): string {
  return `96000000-0000-4000-8000-${String(index + 401).padStart(12, "0")}`;
}

export const annaRow: PersonRow = {
  accountId: storyAnnaId,
  displayName: "Анна Петрова",
  username: "anna_petrova",
  email: "anna.petrova@example.test",
  contactsState: "complete",
  telegram: "linked",
  registeredAt: "2026-09-02T08:00:00.000Z",
  lastActivityAt: "2026-10-26T18:20:00.000Z",
  products: [
    {
      productId: ai.productId,
      name: ai.name,
      access: "active",
      origin: "paid",
    },
    {
      productId: architecture.productId,
      name: architecture.name,
      access: "revoked",
      origin: "manual",
    },
  ],
};

/** Без Telegram: только email, подстрока говорит, что связи нет. */
export const noTelegramRow: PersonRow = {
  accountId: accountId(1),
  displayName: null,
  username: null,
  email: "konstantin.zadunaisky.long.address@example.test",
  contactsState: "complete",
  telegram: "not_linked",
  registeredAt: "2026-08-14T10:00:00.000Z",
  lastActivityAt: null,
  products: [],
};

/** Контакты не прочитались: заголовок говорит «неизвестно», а не «без имени». */
export const unknownContactsRow: PersonRow = {
  accountId: accountId(2),
  displayName: null,
  username: null,
  email: null,
  contactsState: "partial",
  telegram: "linked",
  registeredAt: "2026-07-30T10:00:00.000Z",
  lastActivityAt: "2026-10-01T09:10:00.000Z",
  products: [
    {
      productId: practice.productId,
      name: practice.name,
      access: "active",
      origin: "course_activation",
    },
  ],
};

/** Длинный список: имена разной длины, продукты в разных состояниях. */
export function storyPeopleRows(count: number): PersonRow[] {
  return Array.from({ length: count }, (_, index) => {
    // Со второго имени: первое занято строкой Анны, у списка не бывает двух одинаковых ссылок.
    const name = names[(index % (names.length - 1)) + 1] ?? "Человек";
    const products = storyProducts
      .slice(0, (index % 4) + 1)
      .map((product, at) => ({
        productId: product.productId,
        name: product.name,
        access:
          at === 1 && index % 3 === 0
            ? ("revoked" as const)
            : ("active" as const),
        origin:
          (["paid", "manual", "course_activation", "legacy"] as const)[
            at % 4
          ] ?? "paid",
      }));
    return {
      accountId: accountId(index + 10),
      displayName:
        index < names.length - 1 ? name : `${name} ${String(index + 1)}`,
      username: index % 3 === 2 ? null : `learner_${String(index + 1)}`,
      email:
        index % 2 === 0 ? `learner${String(index + 1)}@example.test` : null,
      contactsState: "complete",
      telegram: index % 3 === 2 ? "not_linked" : "linked",
      registeredAt: new Date(
        Date.UTC(2026, 9, 20, 9) - index * 86_400_000,
      ).toISOString(),
      lastActivityAt:
        index % 4 === 3
          ? null
          : new Date(
              Date.UTC(2026, 9, 26, 15) - index * 3_600_000,
            ).toISOString(),
      products,
    };
  });
}

export function peopleState(
  items: readonly PersonRow[],
  totals: {
    readonly total?: number;
    readonly nextCursor?: string | null;
    readonly nameSearch?: "available" | "unavailable" | "truncated";
  } = {},
): Extract<PeopleListState, { readonly kind: "ready" }> {
  return {
    kind: "ready",
    items: [...items],
    total: totals.total ?? items.length,
    nextCursor: totals.nextCursor ?? null,
    nameSearch: totals.nameSearch ?? "available",
  };
}

const owner = {
  kind: "person" as const,
  accountId: "96000000-0000-4000-8000-0000000004ff",
  label: "Кирилл Сачков",
};

/** Карточка Анны: все блоки ответили, один продукт открыт, другой отозван. */
export const annaCard: PersonCard = {
  person: {
    accountId: storyAnnaId,
    displayName: "Анна Петрова",
    username: "anna_petrova",
    email: "anna.petrova@example.test",
    contactsState: "complete",
    registeredAt: "2026-09-02T08:00:00.000Z",
    telegramUrl: "https://t.me/anna_petrova",
  },
  products: {
    state: "ready",
    items: [
      {
        productId: ai.productId,
        name: ai.name,
        access: "active",
        revision: 1,
        firstIssuedAt: "2026-09-02T08:15:00.000Z",
        origin: "paid",
        history: [
          {
            kind: "purchase",
            at: "2026-09-02T08:15:00.000Z",
            actor: { kind: "system" },
            reason: null,
          },
        ],
      },
      {
        productId: architecture.productId,
        name: architecture.name,
        access: "revoked",
        revision: 3,
        firstIssuedAt: "2026-06-11T12:00:00.000Z",
        origin: "manual",
        history: [
          {
            kind: "revoke",
            at: "2026-10-01T12:40:00.000Z",
            actor: owner,
            reason: "Возврат оплаты",
          },
          {
            kind: "restore",
            at: "2026-08-20T09:00:00.000Z",
            actor: { kind: "unknown" },
            reason: "Другое: оплата нашлась в банке после сверки за август",
          },
          {
            kind: "manual_issue",
            at: "2026-06-11T12:00:00.000Z",
            actor: owner,
            reason: "Компенсация: сбой оплаты в июне",
          },
        ],
      },
    ],
  },
  payments: {
    state: "ready",
    items: [
      {
        paymentId: "96000000-0000-4000-8000-000000000501",
        productId: ai.productId,
        productName: ai.name,
        amountKopecks: 1_499_000,
        state: "confirmed",
        createdAt: "2026-09-02T08:14:00.000Z",
        paymentLinkId: "96000000-0000-4000-8000-000000000601",
      },
      {
        paymentId: "96000000-0000-4000-8000-000000000502",
        productId: architecture.productId,
        productName: architecture.name,
        amountKopecks: 990_000,
        state: "failed",
        createdAt: "2026-08-28T19:02:00.000Z",
        paymentLinkId: null,
      },
    ],
  },
  learning: {
    state: "ready",
    items: [
      {
        productId: ai.productId,
        name: ai.name,
        startedAt: "2026-09-03T10:00:00.000Z",
        progress: {
          state: "measured",
          read: 12,
          total: 40,
          lastActivityAt: "2026-10-26T18:20:00.000Z",
        },
      },
      {
        productId: architecture.productId,
        name: architecture.name,
        startedAt: null,
        progress: { state: "unavailable" },
      },
    ],
  },
  submissions: {
    state: "ready",
    items: [
      {
        productId: ai.productId,
        count: 3,
        lastSubmittedAt: "2026-10-25T11:05:00.000Z",
        lastTaskCode: "agent-review",
      },
    ],
  },
  telegram: {
    state: "ready",
    link: "linked",
    membership: "member",
    restriction: "none",
    marketing: "stopped",
    observedAt: "2026-10-26T09:00:00.000Z",
  },
  waitlists: {
    state: "ready",
    items: [
      {
        productId: practice.productId,
        productName: practice.name,
        intakeName: "Поток весна 2027",
        active: true,
        joinedAt: "2026-10-10T07:30:00.000Z",
      },
      {
        productId: ai.productId,
        productName: ai.name,
        intakeName: "Поток осень 2026",
        active: false,
        joinedAt: "2026-07-01T07:30:00.000Z",
      },
    ],
  },
};

/** Владельцы блоков не ответили; продукты на месте, сдачи закрыты правом. */
export const unavailableBlocksCard: PersonCard = {
  ...annaCard,
  person: {
    ...annaCard.person,
    displayName: "Константин Константинопольский-Задунайский",
    username: null,
    telegramUrl: null,
    email: "konstantin.zadunaisky.long.address@example.test",
  },
  payments: { state: "unavailable" },
  learning: { state: "unavailable" },
  submissions: { state: "forbidden" },
  telegram: { state: "unavailable" },
  waitlists: { state: "unavailable" },
};

/** Новый человек: ничего не купил, Telegram не связан, состояние группы неизвестно. */
export const newcomerCard: PersonCard = {
  person: {
    accountId: accountId(3),
    displayName: null,
    username: null,
    email: "buyer.only@example.test",
    contactsState: "partial",
    registeredAt: "2026-10-25T08:00:00.000Z",
    telegramUrl: null,
  },
  products: { state: "ready", items: [] },
  payments: { state: "ready", items: [] },
  learning: { state: "ready", items: [] },
  submissions: { state: "forbidden" },
  telegram: {
    state: "ready",
    link: "not_linked",
    membership: "unknown",
    restriction: "unknown",
    marketing: "unknown",
    observedAt: null,
  },
  waitlists: { state: "ready", items: [] },
};

export function cardState(card: PersonCard): PersonCardState {
  return { kind: "ready", card };
}

/** Как отвечают команды Product Access в story: успех, устаревшая ревизия или отказ. */
export type StoryAccessReply =
  "ok" | "revision_conflict" | "operation_conflict";

/**
 * BFF выбора продуктов и команд доступа. Предпросмотр отзыва отвечает ревизией карточки, если
 * `preview` не задаёт другую: так story показывает «доступ изменился».
 */
export function accessFetch({
  catalog = "ready",
  community = "closes",
  preview,
  reply = "ok",
}: {
  readonly catalog?: "ready" | "unavailable" | undefined;
  readonly community?: "closes" | "remains" | undefined;
  readonly preview?: number | undefined;
  readonly reply?: StoryAccessReply | undefined;
} = {}): MutationFetch {
  return (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    );
    if (url.pathname === "/api/authoring/people/product-choices")
      return Promise.resolve(
        catalog === "ready"
          ? Response.json({ kind: "ready", products: storyProducts })
          : Response.json(
              { kind: "unavailable", reference: "dependency_unavailable" },
              { status: 503 },
            ),
      );
    const sent = commandSchema.safeParse(
      typeof init?.body === "string" ? JSON.parse(init.body) : {},
    );
    const productId = sent.success ? sent.data.productId : "";
    const revision =
      annaCard.products.state === "ready"
        ? (annaCard.products.items.find((item) => item.productId === productId)
            ?.revision ?? 1)
        : 1;
    const value = {
      accountId: storyAnnaId,
      productId,
      firstIssuedAt: "2026-09-02T08:15:00.000Z",
      access: "active",
      revision: revision + 1,
    };
    if (url.pathname.endsWith("/preview-revoke"))
      return Promise.resolve(
        Response.json({
          ok: true,
          value: {
            ok: true,
            value: {
              accountId: storyAnnaId,
              productId,
              revision: preview ?? revision,
              affectedCount: 1,
              affected: [],
              community,
            },
          },
        }),
      );
    if (reply !== "ok")
      return Promise.resolve(Response.json({ ok: false, code: reply }));
    if (url.pathname.endsWith("/issue"))
      return Promise.resolve(
        Response.json({
          ok: true,
          value: { ok: true, outcome: "issued", value },
        }),
      );
    if (url.pathname.endsWith("/revoke"))
      return Promise.resolve(
        Response.json({
          ok: true,
          value: { ok: true, value: { ...value, access: "revoked" } },
        }),
      );
    if (url.pathname.endsWith("/restore"))
      return Promise.resolve(
        Response.json({ ok: true, value: { ok: true, value } }),
      );
    return Promise.resolve(new Response(null, { status: 404 }));
  };
}
