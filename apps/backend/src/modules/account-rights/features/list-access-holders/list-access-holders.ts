import {
  readTimedEnrollmentAccess,
  type TimedEnrollmentAccess,
} from "../../shared/timed-enrollment-access.js";
import { accessFailure } from "../../domain/access-grant.js";
import {
  ENDING_SOON_WINDOW_MS,
  listAccessHoldersSchema,
  RECENTLY_ENDED_WINDOW_MS,
  type AccessHolder,
  type AccessHolderState,
  type ListAccessHoldersCommand,
} from "../../domain/access-roster.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import type { RecipientLinks } from "../../ports/recipient-links.js";
import {
  enrollmentGround,
  grantGround,
  standaloneGrantSources,
} from "../../shared/access-ground.js";

type Client = AccountRightsPrismaClient;
type EnrollmentWhere = NonNullable<
  NonNullable<Parameters<Client["tariffAssignment"]["findMany"]>[0]>["where"]
>;
type GrantWhere = NonNullable<
  NonNullable<Parameters<Client["accessGrant"]["findMany"]>[0]>["where"]
>;

/** Что Billing знает об Offer фильтра: платежи разовых покупок этого Offer. */
export interface AccessHoldersContext {
  readonly offerPurchaseRefs: readonly string[];
}

/**
 * Страница людей с действующими и недавно закончившимися основаниями, по возрастанию Account.
 * Человек попадает в страницу, если хотя бы одно его основание проходит все фильтры сразу; в
 * ответе у него все основания из окна списка, чтобы карточка показывала полную картину.
 */
export async function listAccessHolders(
  prisma: Client,
  links: Pick<RecipientLinks, "readBinding"> | undefined,
  input: unknown,
  context: AccessHoldersContext,
  now: Date,
) {
  const parsed = listAccessHoldersSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const query = parsed.data;
  if (links === undefined) return accessFailure("unavailable");
  const take = query.limit + 1;
  const after =
    query.cursor === undefined ? {} : { accountId: { gt: query.cursor } };
  const timed = await readTimedEnrollmentAccess(prisma, now);
  const enrollmentFilter = enrollmentCondition(query, now, timed);
  const grantFilter = grantCondition(query, context, now);
  const [enrolled, granted] = await Promise.all([
    enrollmentFilter === null
      ? []
      : prisma.tariffAssignment.findMany({
          where: { AND: [enrollmentFilter, after] },
          distinct: ["accountId"],
          orderBy: { accountId: "asc" },
          take,
          select: { accountId: true },
        }),
    grantFilter === null
      ? []
      : prisma.accessGrant.findMany({
          where: { AND: [grantFilter, after] },
          distinct: ["accountId"],
          orderBy: { accountId: "asc" },
          take,
          select: { accountId: true },
        }),
  ]);
  const accounts = [
    ...new Set([...enrolled, ...granted].map((row) => row.accountId)),
  ]
    .sort()
    .slice(0, take);
  const page = accounts.slice(0, query.limit);
  const [enrollments, grants, bindings] = await Promise.all([
    prisma.tariffAssignment.findMany({
      where: {
        AND: [{ accountId: { in: page } }, listedEnrollment(now, timed)],
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    }),
    prisma.accessGrant.findMany({
      where: { AND: [{ accountId: { in: page } }, listedGrant(now)] },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    }),
    Promise.all(page.map((accountId) => links.readBinding({ accountId }))),
  ]);
  const items: AccessHolder[] = [];
  for (const [index, accountId] of page.entries()) {
    const binding = bindings[index];
    if (binding === undefined || !binding.ok)
      return accessFailure("unavailable");
    items.push({
      accountId,
      telegramIdentityRef: binding.binding?.telegramIdentityRef ?? null,
      grounds: [
        ...enrollments
          .filter((row) => row.accountId === accountId)
          .map((row) => ({
            ...enrollmentGround(row, now),
            state:
              timed.find((entry) => entry.id === row.id)?.state ??
              enrollmentGround(row, now).state,
          })),
        ...grants
          .filter((row) => row.accountId === accountId)
          .map((row) => grantGround(row, now)),
      ],
    });
  }
  return {
    ok: true as const,
    value: {
      items,
      nextCursor: accounts.length > query.limit ? (page.at(-1) ?? null) : null,
    },
  };
}

/** Окно списка: основание не закончилось и не отозвано раньше, чем 30 дней назад. */
function listedEnrollment(
  now: Date,
  timed: TimedEnrollmentAccess,
): EnrollmentWhere {
  const since = new Date(now.getTime() - RECENTLY_ENDED_WINDOW_MS);
  return {
    OR: [
      {
        id: {
          in: timed.filter((entry) => entry.listed).map((entry) => entry.id),
        },
      },
      {
        id: { notIn: timed.map((entry) => entry.id) },
        AND: [
          { OR: [{ revokedAt: null }, { revokedAt: { gt: since } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: since } }] },
        ],
      },
    ],
  };
}
function listedGrant(now: Date): GrantWhere {
  const since = new Date(now.getTime() - RECENTLY_ENDED_WINDOW_MS);
  return {
    enrollmentId: null,
    source: { in: [...standaloneGrantSources] },
    AND: [
      { OR: [{ revokedAt: null }, { revokedAt: { gt: since } }] },
      { OR: [{ validUntil: null }, { validUntil: { gt: since } }] },
    ],
  };
}

/** Границы состояния; `accessGroundState` выводит то же правило по строке. */
function stateWindow(now: Date) {
  return {
    since: new Date(now.getTime() - RECENTLY_ENDED_WINDOW_MS),
    soon: new Date(now.getTime() + ENDING_SOON_WINDOW_MS),
  };
}
function legacyEnrollmentState(
  state: AccessHolderState,
  now: Date,
): EnrollmentWhere {
  const { since, soon } = stateWindow(now);
  switch (state) {
    case "active":
      return {
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      };
    case "expiring":
      return {
        revokedAt: null,
        startsAt: { lte: now },
        endsAt: { gt: now, lte: soon },
      };
    case "ended":
      return {
        OR: [
          { revokedAt: { gt: since } },
          { revokedAt: null, endsAt: { gt: since, lte: now } },
        ],
      };
  }
}
function enrollmentState(
  state: AccessHolderState,
  now: Date,
  timed: TimedEnrollmentAccess,
): EnrollmentWhere {
  return {
    OR: [
      {
        id: {
          in: timed
            .filter(
              (entry) =>
                entry.listed &&
                (state === "expiring"
                  ? entry.expiring
                  : state === "ended"
                    ? entry.state === "ended" || entry.state === "revoked"
                    : entry.state === "active"),
            )
            .map((entry) => entry.id),
        },
      },
      {
        AND: [
          { id: { notIn: timed.map((entry) => entry.id) } },
          legacyEnrollmentState(state, now),
        ],
      },
    ],
  };
}
function grantState(state: AccessHolderState, now: Date): GrantWhere {
  const { since, soon } = stateWindow(now);
  switch (state) {
    case "active":
      return {
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      };
    case "expiring":
      return {
        revokedAt: null,
        startsAt: { lte: now },
        validUntil: { gt: now, lte: soon },
      };
    case "ended":
      return {
        OR: [
          { revokedAt: { gt: since } },
          { revokedAt: null, validUntil: { gt: since, lte: now } },
        ],
      };
  }
}

/** Фильтры для назначений; `null` — ни одно назначение фильтр не проходит. */
function enrollmentCondition(
  query: ListAccessHoldersCommand,
  now: Date,
  timed: TimedEnrollmentAccess,
): EnrollmentWhere | null {
  if (query.source === "one_time_purchase") return null;
  const conditions: EnrollmentWhere[] = [listedEnrollment(now, timed)];
  if (query.source !== undefined) conditions.push({ origin: query.source });
  if (query.offerId !== undefined) conditions.push({ tierId: query.offerId });
  if (query.state !== undefined)
    conditions.push(enrollmentState(query.state, now, timed));
  return { AND: conditions };
}

/** Фильтры для прав без назначения; `null` — ни одно право фильтр не проходит. */
function grantCondition(
  query: ListAccessHoldersCommand,
  context: AccessHoldersContext,
  now: Date,
): GrantWhere | null {
  const conditions: GrantWhere[] = [listedGrant(now)];
  if (query.source === "one_time_purchase") conditions.push({ source: "paid" });
  else if (query.source === "manual")
    conditions.push({ source: { in: ["manual", "legacy"] } });
  else if (query.source !== undefined) return null;
  if (query.offerId !== undefined) {
    // Offer есть только у оплаченного права: его платёж — первая часть sourceRef.
    if (context.offerPurchaseRefs.length === 0) return null;
    conditions.push({
      source: "paid",
      OR: context.offerPurchaseRefs.map((ref) => ({
        sourceRef: { startsWith: `${ref}:` },
      })),
    });
  }
  if (query.state !== undefined) conditions.push(grantState(query.state, now));
  return { AND: conditions };
}
