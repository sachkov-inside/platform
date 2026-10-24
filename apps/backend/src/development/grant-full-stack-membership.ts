import { randomUUID } from "node:crypto";
import { loadPlatformConfig } from "../config/load-platform-config.js";
import { assembleMaterials } from "../entrypoints/composition/assemble-materials.js";
import { createPrismaClient } from "../infrastructure/prisma/index.js";
import {
  assembleAccessGrants,
  assembleAccountRights,
} from "../modules/account-rights/index.js";
import { assembleAccounts } from "../modules/accounts/index.js";
import { assembleContentAccess } from "../modules/content-access/index.js";
import {
  assembleMaterialResourceFacts,
  assembleProductMaterialReading,
} from "../modules/materials/index.js";
import { PublishedProductComposition } from "../modules/products/index.js";
import { ReadingActivity } from "../modules/reading-activity/index.js";
import { enrollPriorParticipantsFixture } from "./enroll-prior-participants-fixture.js";

async function main(): Promise<void> {
  const config = loadPlatformConfig();
  if (config.mode !== "development") {
    throw new Error(
      "Full-stack Membership fixture runs only in development mode",
    );
  }
  const issuer = requiredValue("OWNER_LOGTO_ISSUER");
  const subject = requiredValue("FULLSTACK_MEMBER_LOGTO_SUBJECT");
  if (issuer !== config.identity.issuer) {
    throw new Error("OWNER_LOGTO_ISSUER must exactly match LOGTO_ISSUER");
  }
  const prisma = createPrismaClient(config.database.url);
  try {
    const member = await prisma.account.findUnique({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: issuer,
          logtoSubject: subject,
        },
      },
      select: { id: true },
    });
    if (member === null)
      throw new Error("Full-stack member Account must be established first");
    await enrollPriorParticipantsFixture(prisma, member.id);
    const owner = await prisma.account.upsert({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: issuer,
          logtoSubject: "fullstack-fixture-owner",
        },
      },
      create: {
        id: randomUUID(),
        logtoIssuer: issuer,
        logtoSubject: "fullstack-fixture-owner",
      },
      update: {},
    });
    await prisma.accountPermission.createMany({
      data: { accountId: owner.id, permission: "platform:admin" },
      skipDuplicates: true,
    });
    const accounts = assembleAccounts({
      prisma,
      emailFingerprintKey: "fullstack-isolated-product-fixture-key",
    });
    const grants = assembleAccessGrants({ prisma, accounts });
    for (const state of ["expired", "stale"] as const) {
      const fixtureSubject =
        process.env[
          state === "expired"
            ? "FULLSTACK_EXPIRED_MEMBER_LOGTO_SUBJECT"
            : "FULLSTACK_STALE_MEMBER_LOGTO_SUBJECT"
        ];
      if (fixtureSubject === undefined) continue;
      const fixtureMember = await prisma.account.findUniqueOrThrow({
        where: {
          logtoIssuer_logtoSubject: {
            logtoIssuer: issuer,
            logtoSubject: fixtureSubject,
          },
        },
        select: { id: true },
      });
      await enrollPriorParticipantsFixture(prisma, fixtureMember.id);
      if (state === "expired") {
        const membership = assembleAccountRights({
          prisma,
        });
        const materials = assembleMaterials({
          prisma,
          authorPolicy: { canManage: () => false },
        });
        const reading = new ReadingActivity({
          prisma,
          materialContent: materials.materialContent,
          composition: new PublishedProductComposition(
            prisma,
            assembleProductMaterialReading(prisma),
          ),
          contentAccess: assembleContentAccess({
            materialResourceFacts: assembleMaterialResourceFacts(
              materials.materialContent,
            ),
            accountPermissions: {
              hasMaterialsManage: () => Promise.resolve(false),
            },
            accountRights: membership,
          }),
        });
        const material = await prisma.material.findUniqueOrThrow({
          where: { slug: "developer-pipeline-bez-poteri-konteksta" },
          select: { id: true },
        });
        const states = await reading.getReadingStates({
          accountId: fixtureMember.id,
          materialIds: [material.id],
        });
        if (!states.ok || states.value[0] === undefined)
          throw new Error("Prior ReadingState fixture failed");
        const marked = await reading.setReadingState({
          accountId: fixtureMember.id,
          materialId: material.id,
          expectedVersion: states.value[0].version,
          isRead: true,
          commandId: randomUUID(),
        });
        if (!marked.ok)
          throw new Error(`Prior reading mark failed: ${marked.error.code}`);
      }
      const products = await prisma.product.findMany({
        where: { archivedAt: null },
        select: { id: true },
      });
      for (const product of products) {
        const current = await grants.readProductAccess(owner.id, {
          accountId: fixtureMember.id,
          productId: product.id,
        });
        if (!current.ok) throw new Error("Synthetic Product access must exist");
        const revoked = await grants.revokeProductAccess(owner.id, {
          operationId: randomUUID(),
          accountId: fixtureMember.id,
          productId: product.id,
          expectedRevision: current.value.revision,
          reason: "Synthetic explicit Product withdrawal",
        });
        if (!revoked.ok) throw new Error("Synthetic Product withdrawal failed");
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

function requiredValue(
  name: "FULLSTACK_MEMBER_LOGTO_SUBJECT" | "OWNER_LOGTO_ISSUER",
): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
