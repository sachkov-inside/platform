import {
  peopleScenario,
  peopleDirectoryScenario,
  peopleHistoryScenario,
  peopleCardScenario,
} from "../../../../scenarios/people.mjs";
import type { PersonCard } from "@/_pages/authoring-person/model/person-card";
import type { PersonRow } from "@/_pages/authoring-people/model/people-list";
import type { AccessProduct } from "@/features/product-access-actions";

const commandSchema = z.object({ productId: z.string() }).loose();

/**
 * Данные человека и продуктов для модульных проверок (#1721).
 * Данные детерминированы: без случайности и текущих часов, с настоящими длинами русских имён.
 */

export const storyProducts = [
  {
    productId: "96000000-0000-4000-8000-000000000301",
    name: peopleScenario.products[0].longName,
    archived: peopleScenario.products[0].archived,
  },
  {
    productId: "96000000-0000-4000-8000-000000000302",
    name: peopleScenario.products[1].longName,
    archived: peopleScenario.products[1].archived,
  },
  {
    productId: "96000000-0000-4000-8000-000000000303",
    name: peopleScenario.products[2].longName,
    archived: peopleScenario.products[2].archived,
  },
  {
    productId: "96000000-0000-4000-8000-000000000304",
    name: peopleScenario.products[3].longName,
    archived: peopleScenario.products[3].archived,
  },
] as const satisfies readonly AccessProduct[];

const [ai, architecture, practice] = storyProducts;

export const storyAnnaId = "96000000-0000-4000-8000-000000000401";

const names = [
  peopleScenario.anna.displayName,
  peopleScenario.konstantin.displayName,
  ...peopleScenario.directoryNames.slice(0, 4),
];

function accountId(index: number): string {
  return `96000000-0000-4000-8000-${String(index + 401).padStart(12, "0")}`;
}

export const annaRow: PersonRow = {
  accountId: storyAnnaId,
  displayName: peopleScenario.anna.displayName,
  username: peopleScenario.anna.username,
  email: peopleScenario.anna.email,
  contactsState: "complete",
  telegram: "linked",
  registeredAt: peopleCardScenario.registeredAt,
  lastActivityAt: peopleCardScenario.lastActivityAt,
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
export const annaCard: PersonCard = {
  person: {
    accountId: storyAnnaId,
    displayName: peopleScenario.anna.displayName,
    username: peopleScenario.anna.username,
    email: peopleScenario.anna.email,
    contactsState: "complete",
    registeredAt: peopleCardScenario.registeredAt,
    telegramUrl: `https://t.me/${peopleScenario.anna.username}`,
  },
  products: {
    state: "ready",
    items: [
      {
        productId: ai.productId,
        name: ai.name,
        ...peopleCardScenario.paidAccess,
        firstIssuedAt: peopleHistoryScenario.issuedAt,
        history: [
          {
            kind: "purchase",
            at: peopleHistoryScenario.issuedAt,
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
            at: peopleHistoryScenario.revoke.at,
            actor: owner,
            reason: peopleHistoryScenario.revoke.reason,
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
        amountKopecks: peopleCardScenario.payments[0].amountKopecks,
        state: peopleCardScenario.payments[0].state,
        createdAt: peopleCardScenario.payments[0].createdAt,
        paymentLinkId: "96000000-0000-4000-8000-000000000601",
      },
      {
        paymentId: "96000000-0000-4000-8000-000000000502",
        productId: architecture.productId,
        productName: architecture.name,
        amountKopecks: peopleCardScenario.payments[1].amountKopecks,
        state: peopleCardScenario.payments[1].state,
        createdAt: peopleCardScenario.payments[1].createdAt,
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
        startedAt: peopleCardScenario.learning.startedAt,
        progress: {
          state: "measured",
          read: peopleCardScenario.learning.read,
          total: peopleCardScenario.learning.total,
          lastActivityAt: peopleCardScenario.lastActivityAt,
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
        count: peopleCardScenario.submissions.count,
        lastSubmittedAt: peopleCardScenario.submissions.lastSubmittedAt,
        lastTaskCode: peopleCardScenario.submissions.lastTaskCode,
      },
    ],
  },
  telegram: {
    state: "ready",
    link: "linked",
    membership: peopleCardScenario.telegram.membership,
    restriction: peopleCardScenario.telegram.restriction,
    marketing: peopleCardScenario.telegram.marketing,
    observedAt: peopleCardScenario.telegram.observedAt,
    joinReminders: { ...peopleCardScenario.telegram.joinReminders },
  },
  waitlists: {
    state: "ready",
    items: [
      {
        productId: practice.productId,
        productName: practice.name,
        ...peopleCardScenario.practiceWaitlist,
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
