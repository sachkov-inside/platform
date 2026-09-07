import { loadPlatformConfig } from "../config/load-platform-config.js";
import { createPrismaClient } from "../infrastructure/prisma/index.js";
import { accountId } from "../modules/accounts/index.js";
import { assembleMembershipEntitlements } from "../modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../modules/workshop/index.js";

const MEMBERSHIP_FIXTURE_LIFETIME_MS = 5 * 60_000;

/** Test CLI only: drives the existing entitlement owner, never exposed as an HTTP capability. */
async function main() {
  const config = loadPlatformConfig();
  const decision = process.argv[2];
  if (config.mode !== "development" || process.env.FULLSTACK_WEB_BASE_URL === undefined || config.identity.issuer !== "https://identity.fullstack.test/oidc" || (decision !== "member" && decision !== "not_member")) throw new Error("Expected an isolated local full-stack Membership fixture");
  const prisma = createPrismaClient(config.database.url);
  try {
    const account = await prisma.account.findUniqueOrThrow({ where: { logtoIssuer_logtoSubject: { logtoIssuer: config.identity.issuer, logtoSubject: "fullstack-member" } }, select: { id: true } });
    const now = new Date();
    const membership = assembleMembershipEntitlements({ prisma, workshopEntitlements: assembleWorkshopEntitlements({ prisma }) });
    const result = await membership.acceptEvidence({ accountId: accountId(account.id), deliveryId: `full-stack-home-${now.toISOString()}`, source: "link_time", evidence: {
      checkedAt: now.toISOString(), contractVersion: "inside.membership-evidence.v1", decision, evidenceRef: "full-stack-home-evidence", evidenceVersion: now.getTime(), principalRef: "full-stack-principal", reasonCode: decision === "member" ? "chat_member" : "chat_not_member", telegramIdentityRef: "full-stack-telegram-identity", validUntil: new Date(now.getTime() + MEMBERSHIP_FIXTURE_LIFETIME_MS).toISOString(),
    } });
    if (!result.ok || result.outcome !== "applied") throw new Error("Membership fixture was not applied");
    const material = await prisma.material.findUniqueOrThrow({ where: { slug: "developer-pipeline-bez-poteri-konteksta" }, select: { id: true } });
    const visit = await prisma.readingMaterialVisit.findUnique({ where: { accountId_materialId: { accountId: account.id, materialId: material.id } }, select: { firstOpenedAt: true, lastOpenedAt: true } });
    process.stdout.write(JSON.stringify({ kind: (await membership.resolveForAccess(accountId(account.id))).kind, visit }));
  } finally { await prisma.$disconnect(); }
}
void main().catch(() => { console.error("Full-stack Membership transition failed"); process.exitCode = 1; });
