import { loadRepositoryEnvironment } from "../config/load-repository-environment.js";
import { parsePlatformConfig } from "../config/platform-config.js";
import { createPrismaClient } from "../infrastructure/prisma/index.js";
import { bootstrapOwnerAccount } from "../modules/accounts/index.js";

async function main(): Promise<void> {
  loadRepositoryEnvironment();
  const config = parsePlatformConfig(process.env);
  const issuer = requiredExactValue("OWNER_LOGTO_ISSUER");
  const subject = requiredExactValue("OWNER_LOGTO_SUBJECT");
  if (issuer !== config.identity.issuer) {
    throw new Error("OWNER_LOGTO_ISSUER must exactly match LOGTO_ISSUER");
  }
  const prisma = createPrismaClient(config.database.url);
  try {
    const result = await bootstrapOwnerAccount(prisma, { issuer, subject });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

function requiredExactValue(
  name: "OWNER_LOGTO_ISSUER" | "OWNER_LOGTO_SUBJECT",
): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
