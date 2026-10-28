import { loadRepositoryEnvironment } from "../config/load-repository-environment.js";
import { parsePlatformConfig } from "../config/platform-config.js";
import { createPrismaClient } from "../infrastructure/prisma/index.js";
import { backfillBillingContactFingerprints } from "../modules/accounts/index.js";

async function main(): Promise<void> {
  loadRepositoryEnvironment();
  const config = parsePlatformConfig(process.env);
  if (!config.billingContact) {
    throw new Error(
      "Billing Contact configuration (BILLING_CONTACT_*) is required",
    );
  }
  const prisma = createPrismaClient(config.database.url);
  try {
    const result = await backfillBillingContactFingerprints({
      prisma,
      encryptionKey: config.billingContact.encryptionKey,
      emailFingerprintKey: config.identity.emailFingerprintKey,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
