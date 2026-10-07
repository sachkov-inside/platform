import type { BillingPrisma } from "../../../../infrastructure/prisma/index.js";
import {
  ENDING_SOON_WINDOW_MS,
  type AccessGrants,
  type AccessGround,
  type AccessSource,
} from "../../../account-rights/index.js";
import {
  ownerAccessFailure,
  type AccessSummary,
  type OwnerOperation,
  type OwnerResult,
} from "../../domain/owner-operations.js";
import { priceSnapshotSchema } from "../../domain/pricing.js";
import { MOSCOW_OFFSET_MS } from "../../domain/subscription-period.js";

interface Dependencies {
  readonly prisma: BillingPrisma;
  readonly grants: Pick<
    AccessGrants,
    "listAccessHolders" | "readAccessSummary"
  >;
}
type PeopleCommand = Extract<OwnerOperation, { operation: "people.list" }>;
type OfferName = { readonly id: string; readonly name: string };

/** Сбои списания в сводке — за столько последних дней. */
const PAYMENT_FAILURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Выручка и возвраты в сводке — за столько последних месяцев, включая текущий. */
const REVENUE_MONTHS = 12;

/**
 * `people.list`: страница людей из прав и назначений. Offer разовой покупки Billing знает по
 * платежу, поэтому сам находит платежи Offer фильтра и называет Offer оплаченных прав.
 */
export async function listPeople(
  dependencies: Dependencies,
  actorId: string,
  command: PeopleCommand,
): Promise<OwnerResult> {
  const { prisma, grants } = dependencies;
  const offerPurchaseRefs =
    command.offerId === undefined
      ? []
      : (
          await prisma.billingPurchase.findMany({
            where: {
              kind: "one_time",
              state: "confirmed",
              snapshot: { path: ["offer", "id"], equals: command.offerId },
            },
            select: { id: true },
          })
        ).map((row) => row.id);
  const { operation: _operation, ...query } = command;
  const result = await grants.listAccessHolders(actorId, query, {
    offerPurchaseRefs,
  });
  if (!result.ok) return ownerAccessFailure(result.error.code);
  const offers = await purchaseOffers(
    prisma,
    result.value.items.flatMap((item) => item.grounds),
  );
  return {
    ok: true,
    operationRef: command.operationId,
    result: {
      outcome: "people",
      items: result.value.items.map((item) => ({
        accountId: item.accountId,
        telegramIdentityRef: item.telegramIdentityRef,
        grounds: item.grounds.map((ground) => named(ground, offers)),
      })),
      nextCursor: result.value.nextCursor,
    },
  };
}

/** `access.summary`: люди по Offer, воронка приглашений, внимание владельца и деньги. */
export async function readAccessSummary(
  dependencies: Dependencies,
  actorId: string,
  operationRef: string,
  now: Date,
): Promise<OwnerResult> {
  const { prisma, grants } = dependencies;
  const facts = await grants.readAccessSummary(actorId, now);
  if (!facts.ok) return ownerAccessFailure(facts.error.code);
  const offers = await purchaseOffers(
    prisma,
    facts.value.active.map((entry) => entry.ground),
  );
  const active = new Map<
    string,
    { name: string; paid: Set<string>; gift: Set<string>; course: Set<string> }
  >();
  const soon = new Date(now.getTime() + ENDING_SOON_WINDOW_MS);
  const attention: AccessSummary["attention"][number][] = [];
  const renewing = await renewingAccounts(prisma, facts.value.active);
  for (const { accountId, ground, accessEndsAt } of facts.value.active) {
    const endsAt = accessEndsAt === undefined ? ground.endsAt : accessEndsAt;
    const withOffer = named(ground, offers);
    if (withOffer.offer !== null) {
      const row = active.get(withOffer.offer.id) ?? {
        name: withOffer.offer.name,
        paid: new Set<string>(),
        gift: new Set<string>(),
        course: new Set<string>(),
      };
      row[groupOf(ground.source)].add(accountId);
      active.set(withOffer.offer.id, row);
    }
    if (
      endsAt !== null &&
      new Date(endsAt) <= soon &&
      !(ground.source === "platform_payment" && renewing.has(accountId))
    )
      attention.push({
        accountId,
        reason: "ending",
        source: ground.source,
        offerId: withOffer.offer?.id ?? null,
        title: withOffer.offer?.name ?? ground.capabilities.join(", "),
        at: endsAt,
      });
  }
  attention.push(...(await paymentFailures(prisma, now)));
  return {
    ok: true,
    operationRef,
    result: {
      outcome: "accessSummary",
      value: {
        asOf: now.toISOString(),
        active: [...active.entries()]
          .map(([offerId, row]) => ({
            offerId,
            name: row.name,
            paid: row.paid.size,
            gift: row.gift.size,
            course: row.course.size,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "ru")),
        invitations: facts.value.invitations,
        attention: attention.sort((a, b) =>
          byKeys(
            a.at.localeCompare(b.at),
            a.accountId.localeCompare(b.accountId),
          ),
        ),
        revenue: await revenueByMonth(prisma, now),
      },
    },
  };
}

/**
 * Account, чья подписка продлится: `active` с привязанной и не отозванной картой — то же условие,
 * по которому `endLapsedSubscriptions` её не завершает. Конец периода у них — дата следующего списания.
 * Отменённая подписка и подписка с отвязанной картой кончаются в `paidUntil` и в набор не входят.
 */
async function renewingAccounts(
  prisma: BillingPrisma,
  active: readonly {
    readonly accountId: string;
    readonly ground: AccessGround;
  }[],
): Promise<ReadonlySet<string>> {
  const accounts = active
    .filter(({ ground }) => ground.source === "platform_payment")
    .map((entry) => entry.accountId);
  if (accounts.length === 0) return new Set();
  const rows = await prisma.billingSubscription.findMany({
    where: {
      state: "active",
      bindingCiphertext: { not: null },
      bindingRevokedAt: null,
      accountId: { in: [...new Set(accounts)] },
    },
    select: { accountId: true },
  });
  return new Set(rows.map((row) => row.accountId));
}

function groupOf(source: AccessSource): "paid" | "gift" | "course" {
  switch (source) {
    case "platform_payment":
    case "tribute":
    case "one_time_purchase":
      return "paid";
    case "invitation":
    case "manual":
      return "gift";
    case "course":
      return "course";
  }
}

/** Offer оплаченных прав по их платежам; платёж без снимка Offer остаётся без названия. */
async function purchaseOffers(
  prisma: BillingPrisma,
  grounds: readonly AccessGround[],
): Promise<ReadonlyMap<string, OfferName>> {
  const refs = [
    ...new Set(
      grounds.flatMap((ground) =>
        ground.purchaseRef === null ? [] : [ground.purchaseRef],
      ),
    ),
  ];
  if (refs.length === 0) return new Map();
  const rows = await prisma.billingPurchase.findMany({
    where: { id: { in: refs } },
    select: { id: true, snapshot: true },
  });
  return new Map(
    rows.flatMap((row) => {
      const offer = offerOf(row.snapshot);
      return offer === null ? [] : [[row.id, offer] as const];
    }),
  );
}

function offerOf(snapshot: unknown): OfferName | null {
  const parsed = priceSnapshotSchema.safeParse(snapshot);
  return parsed.success
    ? { id: parsed.data.offer.id, name: parsed.data.offer.name }
    : null;
}

/** Основание с Offer: назначение несёт его само, разовая покупка — через свой платёж. */
function named(
  ground: AccessGround,
  offers: ReadonlyMap<string, OfferName>,
): AccessGround {
  const offer =
    ground.offer ??
    (ground.purchaseRef === null ? undefined : offers.get(ground.purchaseRef));
  return {
    kind: ground.kind,
    id: ground.id,
    revision: ground.revision,
    source: ground.source,
    offer: offer === undefined ? null : { id: offer.id, name: offer.name },
    capabilities: ground.capabilities,
    purchaseRef: ground.purchaseRef,
    startsAt: ground.startsAt,
    endsAt: ground.endsAt,
    revokedAt: ground.revokedAt,
    endPolicy: ground.endPolicy,
    state: ground.state,
  };
}

/** Отказы списания по расписанию за последние 7 дней: уведомление о них уже ушло человеку. */
async function paymentFailures(
  prisma: BillingPrisma,
  now: Date,
): Promise<AccessSummary["attention"]> {
  const notices = await prisma.billingNotice.findMany({
    where: {
      kind: "payment_failed",
      occurredAt: { gt: new Date(now.getTime() - PAYMENT_FAILURE_WINDOW_MS) },
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  const attempts = await prisma.billingPurchase.findMany({
    where: {
      id: {
        in: notices.flatMap((row) =>
          row.attemptRef === null ? [] : [row.attemptRef],
        ),
      },
    },
    select: { id: true, snapshot: true },
  });
  return notices.map((notice) => {
    const attempt = attempts.find((row) => row.id === notice.attemptRef);
    return {
      accountId: notice.accountId,
      reason: "payment_failed" as const,
      source: "platform_payment" as const,
      offerId:
        attempt === undefined ? null : (offerOf(attempt.snapshot)?.id ?? null),
      title: notice.title,
      at: notice.occurredAt.toISOString(),
    };
  });
}

/** Ключ месяца `YYYY-MM` по календарю Москвы. */
function moscowMonth(moment: Date): string {
  return new Date(moment.getTime() + MOSCOW_OFFSET_MS)
    .toISOString()
    .slice(0, 7);
}

/**
 * Подтверждённые оплаты по месяцу подтверждения и подтверждённые возвраты по месяцу, когда банк
 * их подтвердил, по Offer из снимка платежа. Новые месяцы сверху, внутри месяца — по названию.
 * Подтверждённая попытка возврата окончательна: `executeRefund` больше её не обновляет, поэтому
 * её `updatedAt` — момент подтверждения.
 */
async function revenueByMonth(
  prisma: BillingPrisma,
  now: Date,
): Promise<AccessSummary["revenue"]> {
  const local = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  const since = new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth() - (REVENUE_MONTHS - 1),
      1,
    ) - MOSCOW_OFFSET_MS,
  );
  const [payments, refunds] = await Promise.all([
    prisma.billingPurchase.findMany({
      where: { state: "confirmed", confirmedAt: { gte: since, lte: now } },
      select: { amountKopecks: true, confirmedAt: true, snapshot: true },
    }),
    prisma.billingRefund.findMany({
      where: { state: "confirmed", updatedAt: { gte: since, lte: now } },
      select: { amountKopecks: true, updatedAt: true, purchaseRef: true },
    }),
  ]);
  const refunded = await prisma.billingPurchase.findMany({
    where: { id: { in: [...new Set(refunds.map((row) => row.purchaseRef))] } },
    select: { id: true, snapshot: true },
  });
  const rows = new Map<string, AccessSummary["revenue"][number]>();
  function row(month: string, offer: OfferName) {
    const key = `${month}:${offer.id}`;
    const current = rows.get(key) ?? {
      month,
      offerId: offer.id,
      name: offer.name,
      payments: 0,
      revenueKopecks: 0,
      refunds: 0,
      refundedKopecks: 0,
    };
    rows.set(key, current);
    return current;
  }
  for (const payment of payments) {
    const offer = offerOf(payment.snapshot);
    if (offer === null || payment.confirmedAt === null) continue;
    const current = row(moscowMonth(payment.confirmedAt), offer);
    current.payments += 1;
    current.revenueKopecks += Number(payment.amountKopecks);
  }
  for (const refund of refunds) {
    const purchase = refunded.find((item) => item.id === refund.purchaseRef);
    const offer = purchase === undefined ? null : offerOf(purchase.snapshot);
    if (offer === null) continue;
    const current = row(moscowMonth(refund.updatedAt), offer);
    current.refunds += 1;
    current.refundedKopecks += Number(refund.amountKopecks);
  }
  return [...rows.values()].sort((a, b) =>
    byKeys(b.month.localeCompare(a.month), a.name.localeCompare(b.name, "ru")),
  );
}

/** Порядок по первому ключу, при равенстве — по второму. */
function byKeys(first: number, second: number): number {
  return first === 0 ? second : first;
}
