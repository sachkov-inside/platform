import { randomUUID } from "node:crypto";
import type { PlatformPrisma } from "../infrastructure/prisma/index.js";
import {
  assembleAccounts,
  bootstrapOwnerAccount,
} from "../modules/accounts/index.js";
import { assembleAccessGrants } from "../modules/account-rights/index.js";

/** Development CLI fixture only. Existing Accounts, content and learning data are never reset. */
export async function seedLocalStandAccounts(
  prisma: PlatformPrisma,
  issuer: string,
  subjects: { owner: string; learner: string; learnerWithAccess: string },
  clock = () => new Date(),
) {
  if (new Set(Object.values(subjects)).size !== 3)
    throw new Error("Expected three distinct local stand identities");
  const owner = await bootstrapOwnerAccount(
    prisma,
    { issuer, subject: subjects.owner },
    "platform:admin",
  );
  async function learner(subject: string) {
    return (
      await prisma.account.upsert({
        where: {
          logtoIssuer_logtoSubject: {
            logtoIssuer: issuer,
            logtoSubject: subject,
          },
        },
        create: {
          id: randomUUID(),
          logtoIssuer: issuer,
          logtoSubject: subject,
        },
        update: {},
        select: { id: true },
      })
    ).id;
  }
  const plain = await learner(subjects.learner);
  const withAccess = await learner(subjects.learnerWithAccess);
  const tier = {
    id: "16410000-0000-4000-8000-000000000001",
    revision: 1,
    name: "Локальная проверка доступа",
    benefits: ["materials"],
    coverage: { wholePlatform: true, productIds: [], materialIds: [] },
  };
  const accounts = assembleAccounts({
    prisma,
    emailFingerprintKey: "local-stand-fixture-does-not-establish-email",
  });
  const grants = assembleAccessGrants({ prisma, accounts, clock });
  // Author permission opens drafts; Product/course access deliberately uses Account Rights.
  // Keep the two sources separate and grant each local profile its own durable enrollment.
  for (const [target, operationId, sourceRef] of [
    [
      withAccess,
      "16410000-0000-4000-8000-000000000002",
      "local-stand-learner-with-access",
    ],
    [
      owner.accountId,
      "16410000-0000-4000-8000-000000000003",
      "local-stand-owner-full-access",
    ],
  ] as const) {
    const result = await grants.assignEnrollment(
      owner.accountId,
      {
        operationId,
        accountId: target,
        origin: "manual",
        sourceRef,
        tierId: tier.id,
        tierRevision: tier.revision,
        terms: {
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: null,
          endPolicy: "fixed",
        },
        billingRef: null,
        reason: "Development-only local stand access fixture",
      },
      tier,
    );
    if (!result.ok) throw new Error("Local stand access fixture failed");
  }
  return {
    owner: owner.accountId,
    learner: plain,
    learnerWithAccess: withAccess,
  };
}
