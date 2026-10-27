import { randomUUID } from "node:crypto";
import { loadPlatformConfig } from "../config/load-platform-config.js";
import { createPrismaClient } from "../infrastructure/prisma/index.js";
import {
  assembleAccessGrants,
  assembleAccountRights,
} from "../modules/account-rights/index.js";
import { accountId, assembleAccounts } from "../modules/accounts/index.js";
import { enrollPriorParticipantsFixture } from "./enroll-prior-participants-fixture.js";

/** Test CLI only: drives the existing entitlement owner, never exposed as an HTTP capability. */
async function main() {
  const config = loadPlatformConfig();
  const decision = process.argv[2];
  if (
    config.mode !== "development" ||
    process.env["FULLSTACK_WEB_BASE_URL"] === undefined ||
    config.identity.issuer !== "https://identity.fullstack.test/oidc" ||
    (decision !== "member" && decision !== "not_member")
  )
    throw new Error("Expected an isolated local full-stack Membership fixture");
  const prisma = createPrismaClient(config.database.url);
  try {
    const account = await prisma.account.findUniqueOrThrow({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: config.identity.issuer,
          logtoSubject: "fullstack-member",
        },
      },
      select: { id: true },
    });
    await enrollPriorParticipantsFixture(prisma, account.id);
    const membership = assembleAccountRights({ prisma });
    const admin = await prisma.accountPermission.findFirstOrThrow({
      where: { permission: "platform:admin" },
      select: { accountId: true },
    });
    const grants = assembleAccessGrants({
      prisma,
      accounts: assembleAccounts({
        prisma,
        emailFingerprintKey: "fullstack-state-fixture-product-key",
      }),
    });
    const held = await grants.listProductAccess(admin.accountId, {
      accountId: account.id,
      limit: 100,
    });
    if (!held.ok) throw new Error("Cannot read synthetic Product access");
    for (const access of held.value) {
      if (
        (decision === "member" && access.access === "active") ||
        (decision === "not_member" && access.access === "revoked")
      )
        continue;
      const command = {
        accountId: account.id,
        productId: access.productId,
        operationId: randomUUID(),
        expectedRevision: access.revision,
        reason: "Synthetic explicit Product access transition",
      };
      const result =
        decision === "member"
          ? await grants.restoreProductAccess(admin.accountId, command)
          : await grants.revokeProductAccess(admin.accountId, command);
      if (!result.ok) throw new Error("Cannot change synthetic Product access");
    }
    const material = await prisma.material.findUniqueOrThrow({
      where: { slug: "developer-pipeline-bez-poteri-konteksta" },
      select: { id: true },
    });
    const visit = await prisma.readingMaterialVisit.findUnique({
      where: {
        accountId_materialId: {
          accountId: account.id,
          materialId: material.id,
        },
      },
      select: { firstOpenedAt: true, lastOpenedAt: true },
    });
    process.stdout.write(
      JSON.stringify({
        kind: (await membership.resolveForAccess(accountId(account.id))).kind,
        visit,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch(() => {
  console.error("Full-stack Membership transition failed");
  process.exitCode = 1;
});
