import { randomBytes } from "node:crypto";
import { z } from "zod";
import { lockAccountAccess } from "../../../../infrastructure/prisma/index.js";
import { accessFailure } from "../../domain/access-grant.js";
import {
  INVITATION_CLAIM_LIFETIME_MS,
  INVITATION_CODE_BYTES,
  INVITATION_OPEN_LIFETIME_MS,
  invitationState,
  invitationView,
  issueInvitationSchema,
  listInvitationsSchema,
  revokeInvitationSchema,
  type InvitationState,
} from "../../domain/invitation.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";

type InvitationWhere = NonNullable<
  NonNullable<
    Parameters<AccountRightsPrismaClient["invitation"]["findMany"]>[0]
  >["where"]
>;

/**
 * Выдаёт личное приглашение на Offer. Billing уже проверил, что Offer существует и подходит режиму.
 * Id приглашения — operationId команды: повтор той же команды возвращает выданное приглашение.
 */
export async function issueInvitation(
  prisma: AccountRightsPrismaClient,
  actorId: string,
  input: unknown,
  offer: { readonly id: string; readonly revision: number },
  now: Date,
) {
  const parsed = issueInvitationSchema.safeParse(input);
  if (!parsed.success || parsed.data.offerId !== offer.id)
    return accessFailure("invalid_input");
  const command = parsed.data;
  const note = command.note === "" ? null : command.note;
  return prisma.$transaction(async (tx) => {
    await lockAccountAccess(tx, `invitation:${command.operationId}`);
    const existing = await tx.invitation.findUnique({
      where: { id: command.operationId },
    });
    if (existing !== null)
      return existing.issuedBy === actorId &&
        existing.offerId === command.offerId &&
        existing.mode === command.mode &&
        existing.note === note
        ? { ok: true as const, value: invitationView(existing, now) }
        : accessFailure("operation_conflict");
    const row = await tx.invitation.create({
      data: {
        id: command.operationId,
        code: randomBytes(INVITATION_CODE_BYTES).toString("base64url"),
        offerId: offer.id,
        offerRevision: offer.revision,
        mode: command.mode,
        note,
        issuedBy: actorId,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + INVITATION_OPEN_LIFETIME_MS),
        revision: 1,
      },
    });
    return { ok: true as const, value: invitationView(row, now) };
  });
}

/** Отзывает неиспользованное приглашение. Погашённое не отзывается: доступ меняется отдельно. */
export async function revokeInvitation(
  prisma: AccountRightsPrismaClient,
  input: unknown,
  now: Date,
) {
  const parsed = revokeInvitationSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const command = parsed.data;
  return prisma.$transaction(async (tx) => {
    const row = await tx.invitation.findUnique({
      where: { id: command.invitationId },
    });
    if (row === null) return accessFailure("not_found");
    await lockAccountAccess(tx, `invitation-code:${row.code}`);
    const current = await tx.invitation.findUniqueOrThrow({
      where: { id: row.id },
    });
    if (current.revision !== command.expectedRevision)
      return accessFailure("revision_conflict");
    const state = invitationState(current, now);
    if (state !== "issued" && state !== "claimed")
      return accessFailure("state_conflict");
    const revoked = await tx.invitation.update({
      where: { id: current.id },
      data: { revokedAt: now, revision: current.revision + 1 },
    });
    return { ok: true as const, value: invitationView(revoked, now) };
  });
}

/** Страница приглашений, новые сначала, с фильтром по состоянию и Offer. */
export async function listInvitations(
  prisma: AccountRightsPrismaClient,
  input: unknown,
  now: Date,
) {
  const parsed = listInvitationsSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const query = parsed.data;
  const conditions: InvitationWhere[] = [];
  if (query.offerId !== undefined) conditions.push({ offerId: query.offerId });
  if (query.state !== undefined)
    conditions.push(stateCondition(query.state, now));
  if (query.cursor !== undefined) {
    const cursor = await prisma.invitation.findUnique({
      where: { id: query.cursor },
      select: { issuedAt: true, id: true },
    });
    if (cursor === null) return accessFailure("invalid_input");
    conditions.push({
      OR: [
        { issuedAt: { lt: cursor.issuedAt } },
        { issuedAt: cursor.issuedAt, id: { lt: cursor.id } },
      ],
    });
  }
  const rows = await prisma.invitation.findMany({
    where: { AND: conditions },
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });
  const items = rows.slice(0, query.limit);
  return {
    ok: true as const,
    value: {
      items: items.map((row) => invitationView(row, now)),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    },
  };
}

/** То же правило, что `invitationState`, условием запроса. */
function stateCondition(state: InvitationState, now: Date): InvitationWhere {
  const claimDeadline = new Date(now.getTime() - INVITATION_CLAIM_LIFETIME_MS);
  const open = { revokedAt: null, redeemedAt: null };
  switch (state) {
    case "revoked":
      return { revokedAt: { not: null } };
    case "redeemed":
      return { redeemedAt: { not: null } };
    case "claimed":
      return { ...open, claimedAt: { gt: claimDeadline } };
    case "issued":
      return { ...open, claimedAt: null, expiresAt: { gt: now } };
    case "expired":
      return {
        ...open,
        OR: [
          { claimedAt: null, expiresAt: { lte: now } },
          { claimedAt: { lte: claimDeadline } },
        ],
      };
  }
}

/** Одно приглашение по id: повтор выдачи отдаёт его без новой проверки Offer. */
export async function readInvitation(
  prisma: AccountRightsPrismaClient,
  invitationId: string,
  now: Date,
) {
  if (!z.uuid().safeParse(invitationId).success)
    return accessFailure("invalid_input");
  const row = await prisma.invitation.findUnique({
    where: { id: invitationId },
  });
  return row === null
    ? accessFailure("not_found")
    : { ok: true as const, value: invitationView(row, now) };
}
