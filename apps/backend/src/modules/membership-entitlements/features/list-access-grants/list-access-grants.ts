import { z } from "zod";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import {
  accessCapabilitySchema,
  accessFailure,
  type AccessFailure,
} from "../../domain/access-grant.js";

const commandSchema = z.object({ accountId: z.uuid() }).strict();
export type ListAccessGrantsCommand = z.input<typeof commandSchema>;
export const accessGrantViewSchema = z.object({
  grantRef: z.uuid(),
  accountId: z.uuid(),
  source: z.enum(["paid", "manual", "legacy"]),
  sourceRef: z.string(),
  capabilities: z.array(accessCapabilitySchema),
  startsAt: z.iso.datetime(),
  validUntil: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  revision: z.number().int().positive(),
  reason: z.string(),
  /** Действует ли основание сейчас: не отозвано, началось и не истекло. */
  active: z.boolean(),
});
export const accessChangeViewSchema = z.object({
  revision: z.number().int().positive(),
  grantRef: z.uuid().nullable(),
  actorId: z.uuid().nullable(),
  operationId: z.uuid(),
  kind: z.string(),
  reason: z.string(),
  recordedAt: z.iso.datetime(),
});
export const accessGrantsViewSchema = z.object({
  accountId: z.uuid(),
  grants: z.array(accessGrantViewSchema),
  history: z.array(accessChangeViewSchema),
});
export type AccessGrantsView = z.infer<typeof accessGrantsViewSchema>;
export type ListAccessGrantsResult =
  | AccessFailure<"invalid_input">
  | { readonly ok: true; readonly value: AccessGrantsView };

/** Права одного Account с источником, сроком и историей изменений; без provider данных. */
export async function listAccessGrants(
  prisma: MembershipEntitlementsPrismaClient,
  input: ListAccessGrantsCommand,
  now: Date,
): Promise<ListAccessGrantsResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const { accountId } = parsed.data;
  const [grants, history] = await Promise.all([
    prisma.accessGrant.findMany({
      where: { accountId },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    }),
    prisma.accessChange.findMany({
      where: { accountId },
      orderBy: { revision: "asc" },
      take: 500,
    }),
  ]);
  return {
    ok: true,
    value: accessGrantsViewSchema.parse({
      accountId,
      grants: grants.map((grant) => ({
        grantRef: grant.id,
        accountId: grant.accountId,
        source: grant.source,
        sourceRef: grant.sourceRef,
        capabilities: grant.capabilities,
        startsAt: grant.startsAt.toISOString(),
        validUntil: grant.validUntil?.toISOString() ?? null,
        revokedAt: grant.revokedAt?.toISOString() ?? null,
        revision: grant.revision,
        reason: grant.reason,
        active:
          grant.revokedAt === null &&
          grant.startsAt <= now &&
          (grant.validUntil === null || grant.validUntil > now),
      })),
      history: history.map((change) => ({
        revision: change.revision,
        grantRef: change.grantId,
        actorId: change.actorId,
        operationId: change.operationId,
        kind: change.kind,
        reason: change.reason,
        recordedAt: change.recordedAt.toISOString(),
      })),
    }),
  };
}
