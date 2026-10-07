import type { PriceSnapshot } from "@/entities/subscription";
import type {
  AccessHolder,
  AccessSummary,
  PersonGround,
} from "@/features/billing-admin/model/access-operations";
import type { Invitation } from "@/features/billing-admin/model/invitation-operations";
import {
  billingOk,
  type BillingRoutes,
} from "@/features/billing-admin/ui/billing-bff.fixtures";
import {
  guideOnlyOffer,
  materialsOffer,
  supportOffer,
} from "@/storybook/billing.fixtures";

/**
 * Данные раздела «Доступ» для Storybook: каталог владельца, приглашения, люди и сводка. Только
 * выдуманные коды, Account и Telegram: настоящие данные живут в production БД.
 */

const uuid = (value: string) =>
  `00000000-0000-4000-8000-${value.padStart(12, "0")}`;

/** Подписка только по приглашению, продающаяся подписка с двумя сроками и руководство без продажи. */
export const accessOffers: readonly PriceSnapshot[] = [
  {
    ...supportOffer,
    offer: { ...supportOffer.offer, eligibility: "invitation_only" },
  },
  materialsOffer,
  {
    ...materialsOffer,
    paymentOption: {
      ...materialsOffer.paymentOption,
      id: uuid("299"),
      months: 12,
      priceKopecks: 1_000_000,
    },
  },
  guideOnlyOffer,
];

const subscription = {
  id: supportOffer.offer.id,
  name: supportOffer.offer.name,
};
const materials = {
  id: materialsOffer.offer.id,
  name: materialsOffer.offer.name,
};
const guide = { id: guideOnlyOffer.offer.id, name: guideOnlyOffer.offer.name };

export function invitation(
  id: string,
  overrides: Partial<Invitation> = {},
): Invitation {
  const code = `Syn7hetic${id}`;
  return {
    id: uuid(id),
    code,
    startParameter: `i_${code}`,
    offerId: materialsOffer.offer.id,
    offerRevision: 3,
    mode: "purchase",
    note: null,
    state: "issued",
    issuedAt: "2030-04-01T09:00:00.000Z",
    expiresAt: "2030-04-15T09:00:00.000Z",
    claimedAt: null,
    redeemedAt: null,
    revokedAt: null,
    accountId: null,
    revision: 1,
    link: `https://t.me/synthetic_inside_bot?start=i_${code}`,
    ...overrides,
  };
}

/** Приглашение в каждом состоянии: выдано, открыто, оплачено, подарено, сгорело, отозвано. */
export const everyStateInvitations: readonly Invitation[] = [
  invitation("e01", { note: "Гость эфира, оплата со скидкой" }),
  invitation("e02", {
    mode: "purchase",
    offerId: supportOffer.offer.id,
    state: "claimed",
    claimedAt: "2030-04-02T10:00:00.000Z",
    revision: 2,
  }),
  invitation("e03", {
    state: "redeemed",
    claimedAt: "2030-04-02T10:00:00.000Z",
    redeemedAt: "2030-04-02T10:05:00.000Z",
    accountId: uuid("c01"),
    revision: 3,
  }),
  invitation("e05", { state: "expired", revision: 2 }),
  invitation("e06", {
    state: "revoked",
    revokedAt: "2030-04-04T12:00:00.000Z",
    revision: 2,
    link: null,
  }),
];

function ground(
  id: string,
  overrides: Partial<PersonGround> = {},
): PersonGround {
  return {
    kind: "enrollment",
    id: uuid(id),
    revision: 1,
    source: "platform_payment",
    offer: subscription,
    capabilities: ["community", "materials"],
    purchaseRef: null,
    startsAt: "2030-03-01T00:00:00.000Z",
    endsAt: "2030-04-01T21:00:00.000Z",
    revokedAt: null,
    endPolicy: "fixed",
    state: "active",
    ...overrides,
  };
}

export const personId = (id: string) => uuid(id);

/** Люди с основаниями из каждого источника, включая закончившееся и отозванное. */
export const accessPeople: readonly AccessHolder[] = [
  {
    accountId: uuid("c01"),
    telegramIdentityRef: "telegram:synthetic-01",
    grounds: [ground("d01")],
  },
  {
    accountId: uuid("c02"),
    telegramIdentityRef: null,
    grounds: [ground("d02", { source: "manual", endsAt: null })],
  },
  {
    accountId: uuid("c03"),
    telegramIdentityRef: "telegram:synthetic-03",
    grounds: [
      ground("d03", { source: "course", offer: materials, endsAt: null }),
    ],
  },
  {
    accountId: uuid("c04"),
    telegramIdentityRef: "telegram:synthetic-04",
    grounds: [
      ground("d04", {
        source: "manual",
        state: "ended",
        endsAt: "2030-03-01T21:00:00.000Z",
      }),
      ground("d05", {
        kind: "grant",
        source: "manual",
        offer: null,
        capabilities: ["community"],
        endPolicy: null,
      }),
    ],
  },
  {
    accountId: uuid("c05"),
    telegramIdentityRef: null,
    grounds: [
      ground("d06", {
        kind: "grant",
        source: "one_time_purchase",
        offer: guide,
        capabilities: ["materials"],
        purchaseRef: uuid("e01"),
        endsAt: null,
        endPolicy: null,
      }),
    ],
  },
  {
    accountId: uuid("c06"),
    telegramIdentityRef: null,
    grounds: [
      ground("d07", {
        source: "tribute",
        state: "revoked",
        revokedAt: "2030-03-10T09:00:00.000Z",
        endPolicy: "confirmed_external",
      }),
    ],
  },
];

/** Тарифы, которые владелец назначает без оплаты: подписка и «Материалы». */
const accessTiers = [supportOffer, materialsOffer].map(({ offer }) => ({
  tier: {
    id: offer.id,
    revision: offer.revision,
    name: offer.name,
    benefits: offer.benefits,
    contentScope: { guideIds: [], materialIds: [] },
  },
  availableForAssignment: true,
  published: true,
  archived: false,
}));

/** Выдуманные цифры: настоящая сводка живёт в production БД. */
export const accessSummary: AccessSummary = {
  asOf: "2030-03-15T12:00:00.000Z",
  active: [
    {
      offerId: materials.id,
      name: materials.name,
      paid: 0,
      gift: 0,
      course: 41,
    },
    {
      offerId: subscription.id,
      name: subscription.name,
      paid: 128,
      gift: 9,
      course: 0,
    },
  ],
  invitations: {
    issued: 24,
    opened: 19,
    purchaseOpened: 12,
    paid: 8,
    expired: 3,
    revoked: 1,
  },
  attention: [
    {
      accountId: uuid("c01"),
      reason: "payment_failed",
      source: "platform_payment",
      offerId: subscription.id,
      title: subscription.name,
      at: "2030-03-14T09:00:00.000Z",
    },
    {
      accountId: uuid("c02"),
      reason: "ending",
      source: "manual",
      offerId: subscription.id,
      title: subscription.name,
      at: "2030-03-20T21:00:00.000Z",
    },
  ],
  revenue: [
    {
      month: "2030-03",
      offerId: subscription.id,
      name: subscription.name,
      payments: 31,
      revenueKopecks: 3_069_000,
      refunds: 1,
      refundedKopecks: 99_000,
    },
    {
      month: "2030-02",
      offerId: subscription.id,
      name: subscription.name,
      payments: 27,
      revenueKopecks: 2_673_000,
      refunds: 0,
      refundedKopecks: 0,
    },
  ],
};

export function invitationsReply(
  items: readonly Invitation[],
  nextCursor: string | null = null,
) {
  return billingOk({ outcome: "invitations", items, nextCursor });
}

export function peopleReply(
  items: readonly AccessHolder[],
  nextCursor: string | null = null,
) {
  return billingOk({ outcome: "people", items, nextCursor });
}

export function issuedInvitationReply(issued: Invitation) {
  return billingOk({ outcome: "invitation", value: issued });
}

export function summaryReply(value: AccessSummary) {
  return billingOk({ outcome: "accessSummary", value });
}

/** Чтения всех четырёх вкладок: панели смонтированы сразу, даже скрытые. */
export const accessReads: BillingRoutes = {
  "invitations/list": invitationsReply(everyStateInvitations),
  "people/list": peopleReply(accessPeople),
  "tiers/list": billingOk({
    outcome: "tiers",
    items: accessTiers,
    nextCursor: null,
  }),
  "access-summary": summaryReply(accessSummary),
};

/** Курсор следующей страницы: список предлагает «Показать ещё». */
export const nextPageCursor = uuid("f99");
