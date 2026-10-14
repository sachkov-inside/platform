import { projectTimedEnrollmentAccess } from "../../shared/timed-enrollment-access.js";
import {
  enrollmentAccountCandidates,
  grantAccountCandidates,
  rosterEnrollmentIds,
  rosterTimedGrantBounds,
} from "./roster-candidates.js";
import { accessFailure } from "../../domain/access-grant.js";
import {
  ENDING_SOON_WINDOW_MS,
  listAccessHoldersSchema,
  RECENTLY_ENDED_WINDOW_MS,
  type AccessHolder,
} from "../../domain/access-roster.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import type { RecipientLinks } from "../../ports/recipient-links.js";
import {
  enrollmentGround,
  grantGround,
  standaloneGrantSources,
} from "../../shared/access-ground.js";

type Client = AccountRightsPrismaClient;
type GrantWhere = NonNullable<
  NonNullable<Parameters<Client["accessGrant"]["findMany"]>[0]>["where"]
>;

/** Что Billing знает об Offer фильтра: платежи разовых покупок этого Offer. */
export interface AccessHoldersContext {
  readonly offerPurchaseRefs: readonly string[];
  readonly matchOfferPurchaseRefs?: (
    refs: readonly string[],
  ) => Promise<readonly string[]>;
}

/**
 * Страница людей с действующими и недавно закончившимися основаниями, по возрастанию Account.
 * Человек попадает в страницу, если хотя бы одно его основание проходит все фильтры сразу; в
 * ответе у него все основания из окна списка, чтобы карточка показывала полную картину.
 */
export async function listAccessHolders(
  prisma: Client,
  links: Pick<RecipientLinks, "readBindings"> | undefined,
  input: unknown,
  context: AccessHoldersContext,
  now: Date,
) {
  const parsed = listAccessHoldersSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const query = {
    ...parsed.data,
    ...(parsed.data.offerId === undefined
      ? {}
      : { offerId: parsed.data.offerId.toLowerCase() }),
  };
  if (links === undefined) return accessFailure("unavailable");
  const items: AccessHolder[] = [];
  const batchSize = 100;
  const since = new Date(now.getTime() - RECENTLY_ENDED_WINDOW_MS);
  let cursor = query.cursor;
  while (items.length <= query.limit) {
    const [enrolled, granted] = await Promise.all([
      enrollmentAccountCandidates(prisma, query, now, cursor, batchSize),
      grantAccountCandidates(prisma, query, now, cursor, batchSize, context),
    ]);
    const candidates = [...new Set([...enrolled, ...granted])]
      .sort()
      .slice(0, batchSize);
    if (candidates.length === 0) break;
    const ids = await rosterEnrollmentIds(prisma, candidates, now);
    const [enrollments, grants] = await Promise.all([
      prisma.tariffAssignment.findMany({
        where: { id: { in: ids } },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      }),
      prisma.accessGrant.findMany({
        where: { AND: [{ accountId: { in: candidates } }, listedGrant(now)] },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      }),
    ]);
    const timedGrants = await rosterTimedGrantBounds(prisma, ids);
    const timed = projectTimedEnrollmentAccess(enrollments, timedGrants, now);
    const timedById = new Map(timed.map((entry) => [entry.id, entry]));
    const isListed = (row: (typeof enrollments)[number]) =>
      timedById.get(row.id)?.listed ??
      ((row.revokedAt === null || row.revokedAt > since) &&
        (row.endsAt === null || row.endsAt > since));
    const enrollmentsByAccount = new Map<string, typeof enrollments>();
    const grantsByAccount = new Map<string, typeof grants>();
    for (const row of enrollments) {
      const grouped = enrollmentsByAccount.get(row.accountId) ?? [];
      grouped.push(row);
      enrollmentsByAccount.set(row.accountId, grouped);
    }
    for (const row of grants) {
      const grouped = grantsByAccount.get(row.accountId) ?? [];
      grouped.push(row);
      grantsByAccount.set(row.accountId, grouped);
    }
    const refs = [
      ...new Set(
        grants
          .filter((row) => row.source === "paid")
          .map((row) => row.sourceRef.split(":")[0])
          .filter((ref): ref is string => ref !== undefined),
      ),
    ];
    const allowedRefs = new Set(
      context.matchOfferPurchaseRefs === undefined
        ? context.offerPurchaseRefs
        : await context.matchOfferPurchaseRefs(refs),
    );
    const eligible = candidates.filter((accountId) => {
      const enrollmentMatches = (
        enrollmentsByAccount.get(accountId) ?? []
      ).some((row) => {
        const timedAccess = timedById.get(row.id);
        const ground = enrollmentGround(row, now);
        if (!isListed(row)) return false;
        if (
          query.source === "one_time_purchase" ||
          (query.source !== undefined && row.origin !== query.source)
        )
          return false;
        if (query.offerId !== undefined && row.tierId !== query.offerId)
          return false;
        const state = timedAccess?.state ?? ground.state;
        return (
          query.state === undefined ||
          (query.state === "expiring"
            ? (timedAccess?.expiring ??
              (state === "active" &&
                row.endsAt !== null &&
                row.endsAt <= new Date(now.getTime() + ENDING_SOON_WINDOW_MS)))
            : query.state === "ended"
              ? state === "ended" || state === "revoked"
              : state === "active")
        );
      });
      const grantMatches = (grantsByAccount.get(accountId) ?? []).some(
        (row) => {
          const ground = grantGround(row, now);
          if (
            query.source !== undefined &&
            (query.source === "one_time_purchase"
              ? row.source !== "paid"
              : query.source === "manual"
                ? row.source !== "manual" && row.source !== "legacy"
                : true)
          )
            return false;
          if (
            query.offerId !== undefined &&
            (row.source !== "paid" ||
              !row.sourceRef.includes(":") ||
              !allowedRefs.has(row.sourceRef.split(":")[0] ?? ""))
          )
            return false;
          return (
            query.state === undefined ||
            (query.state === "expiring"
              ? ground.state === "active" &&
                row.validUntil !== null &&
                row.validUntil <=
                  new Date(now.getTime() + ENDING_SOON_WINDOW_MS)
              : query.state === "ended"
                ? ground.state === "ended" || ground.state === "revoked"
                : ground.state === "active")
          );
        },
      );
      return enrollmentMatches || grantMatches;
    });
    const bindings = await links.readBindings(eligible);
    if (!bindings.ok) return accessFailure("unavailable");
    for (const accountId of eligible) {
      items.push({
        accountId,
        telegramIdentityRef:
          bindings.bindings.get(accountId)?.telegramIdentityRef ?? null,
        grounds: [
          ...(enrollmentsByAccount.get(accountId) ?? [])
            .filter(isListed)
            .map((row) => ({
              ...enrollmentGround(row, now),
              state:
                timedById.get(row.id)?.state ??
                enrollmentGround(row, now).state,
            })),
          ...(grantsByAccount.get(accountId) ?? []).map((row) =>
            grantGround(row, now),
          ),
        ],
      });
      if (items.length > query.limit) break;
    }
    cursor = candidates.at(-1);
    if (
      enrolled.length < batchSize &&
      granted.length < batchSize &&
      candidates.length < batchSize
    )
      break;
  }
  const page = items.slice(0, query.limit);
  return {
    ok: true as const,
    value: {
      items: page,
      nextCursor:
        items.length > query.limit ? (page.at(-1)?.accountId ?? null) : null,
    },
  };
}

/** Окно списка: основание не закончилось и не отозвано раньше, чем 30 дней назад. */
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
