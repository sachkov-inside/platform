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
