import { loadPlatformConfig } from "../config/load-platform-config.js";
import { createPrismaClient } from "../infrastructure/prisma/index.js";
import { accountId } from "../modules/accounts/index.js";
import { assembleMembershipEntitlements } from "../modules/membership-entitlements/index.js";

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
    const result = await assembleMembershipEntitlements({ prisma }).acceptEvidence({
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
