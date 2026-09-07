import { randomUUID } from "node:crypto";
import { assembleMaterials, assembleMaterialResourceFacts, PublishedSeriesComposition } from "../modules/materials/index.js";
import { assembleContentAccess } from "../modules/content-access/index.js";
import { ReadingActivity } from "../modules/reading-activity/index.js";
import { loadPlatformConfig } from "../config/load-platform-config.js";
import { createPrismaClient } from "../infrastructure/prisma/index.js";
import { accountId } from "../modules/accounts/index.js";
import { assembleMembershipEntitlements } from "../modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../modules/workshop/index.js";

const FULL_STACK_MEMBERSHIP_LIFETIME_MS = minutesInMilliseconds(5);

async function main(): Promise<void> {
  const config = loadPlatformConfig();
  if (config.mode !== "development") {
    throw new Error("Full-stack Membership fixture runs only in development mode");
  }
  const issuer = requiredValue("OWNER_LOGTO_ISSUER");
  const subject = requiredValue("FULLSTACK_MEMBER_LOGTO_SUBJECT");
  if (issuer !== config.identity.issuer) {
    throw new Error("OWNER_LOGTO_ISSUER must exactly match LOGTO_ISSUER");
  }
  const prisma = createPrismaClient(config.database.url);
  try {
    const member = await prisma.account.findUnique({
      where: { logtoIssuer_logtoSubject: { logtoIssuer: issuer, logtoSubject: subject } },
      select: { id: true },
    });
    if (member === null) throw new Error("Full-stack member Account must be established first");
    const checkedAt = new Date();
    const validUntil = new Date(
      checkedAt.getTime() + FULL_STACK_MEMBERSHIP_LIFETIME_MS,
    );
    const result = await assembleMembershipEntitlements({
      prisma,
      workshopEntitlements: assembleWorkshopEntitlements({ prisma }),
    }).acceptEvidence({
      accountId: accountId(member.id),
      deliveryId: `full-stack-${checkedAt.toISOString()}`,
      evidence: {
        checkedAt: checkedAt.toISOString(),
        contractVersion: "inside.membership-evidence.v1",
        decision: "member",
        evidenceRef: "full-stack-evidence",
        evidenceVersion: checkedAt.getTime(),
        principalRef: "full-stack-principal",
        reasonCode: "chat_member",
        telegramIdentityRef: "full-stack-telegram-identity",
        validUntil: validUntil.toISOString(),
      },
      source: "link_time",
    });
    if (!result.ok || result.outcome !== "applied") {
      throw new Error(`Full-stack Membership fixture failed: ${JSON.stringify(result)}`);
    }
    for (const state of ["expired", "stale"] as const) {
      const fixtureSubject = process.env[state === "expired"
        ? "FULLSTACK_EXPIRED_MEMBER_LOGTO_SUBJECT"
        : "FULLSTACK_STALE_MEMBER_LOGTO_SUBJECT"];
      if (fixtureSubject === undefined) continue;
      const fixtureMember = await prisma.account.findUniqueOrThrow({
        where: { logtoIssuer_logtoSubject: { logtoIssuer: issuer, logtoSubject: fixtureSubject } },
        select: { id: true },
      });
      if (state === "expired") {
        const membership = assembleMembershipEntitlements({ prisma, workshopEntitlements: assembleWorkshopEntitlements({ prisma }) });
        const prior = new Date(checkedAt.getTime() - 1);
        const granted = await membership.acceptEvidence({ accountId: accountId(fixtureMember.id), deliveryId: `full-stack-expired-before-${checkedAt.toISOString()}`, source: "link_time", evidence: {
          checkedAt: prior.toISOString(), contractVersion: "inside.membership-evidence.v1", decision: "member", evidenceRef: "full-stack-expired-before", evidenceVersion: prior.getTime(), principalRef: "full-stack-expired-principal", reasonCode: "chat_member", telegramIdentityRef: "full-stack-expired-telegram-identity", validUntil: new Date(prior.getTime() + FULL_STACK_MEMBERSHIP_LIFETIME_MS).toISOString(),
        } });
        if (!granted.ok || granted.outcome !== "applied") throw new Error(`Prior active Membership fixture failed: ${JSON.stringify(granted)}`);
        const materials = assembleMaterials({ prisma, authorPolicy: { canManage: () => false } });
        const reading = new ReadingActivity({ prisma, materialContent: materials.materialContent, composition: new PublishedSeriesComposition(prisma), contentAccess: assembleContentAccess({ materialResourceFacts: assembleMaterialResourceFacts(materials.materialContent), accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) }, membershipEntitlements: membership }) });
        const material = await prisma.material.findUniqueOrThrow({ where: { slug: "developer-pipeline-bez-poteri-konteksta" }, select: { id: true } });
        const states = await reading.getReadingStates({ accountId: fixtureMember.id, materialIds: [material.id] });
        if (!states.ok || states.value[0] === undefined) throw new Error("Prior ReadingState fixture failed");
        const marked = await reading.setReadingState({ accountId: fixtureMember.id, materialId: material.id, expectedVersion: states.value[0].version, isRead: true, commandId: randomUUID() });
        if (!marked.ok) throw new Error(`Prior reading mark failed: ${marked.error.code}`);
      }
      // Distinguish confirmed loss of Membership from an observation whose validity elapsed.
      const observedAt = state === "expired" ? checkedAt
        : new Date(checkedAt.getTime() - 2 * FULL_STACK_MEMBERSHIP_LIFETIME_MS);
      const deniedResult = await assembleMembershipEntitlements({
        prisma,
        workshopEntitlements: assembleWorkshopEntitlements({ prisma }),
        clock: () => observedAt,
      }).acceptEvidence({
        accountId: accountId(fixtureMember.id),
        deliveryId: `full-stack-${state}-${checkedAt.toISOString()}`,
        evidence: {
          checkedAt: observedAt.toISOString(),
          contractVersion: "inside.membership-evidence.v1",
          decision: state === "expired" ? "not_member" : "member",
          evidenceRef: `full-stack-${state}-evidence`,
          evidenceVersion: observedAt.getTime(),
          principalRef: `full-stack-${state}-principal`,
          reasonCode: state === "expired" ? "chat_not_member" : "chat_member",
          telegramIdentityRef: `full-stack-${state}-telegram-identity`,
          validUntil: new Date(observedAt.getTime() + FULL_STACK_MEMBERSHIP_LIFETIME_MS).toISOString(),
        },
        source: "link_time",
      });
      if (!deniedResult.ok || deniedResult.outcome !== "applied") {
        throw new Error(`${state} Membership fixture failed: ${JSON.stringify(deniedResult)}`);
      }
      const resolved = await assembleMembershipEntitlements({
        prisma, workshopEntitlements: assembleWorkshopEntitlements({ prisma }),
      }).resolveForAccess(accountId(fixtureMember.id));
      if (resolved.kind !== state) throw new Error(`Membership fixture must resolve as ${state}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function minutesInMilliseconds(minutes: number): number {
  return minutes * 60 * 1_000;
}

function requiredValue(name: "FULLSTACK_MEMBER_LOGTO_SUBJECT" | "OWNER_LOGTO_ISSUER"): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
