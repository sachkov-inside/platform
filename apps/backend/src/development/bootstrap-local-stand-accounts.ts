import { z } from "zod";
import { loadPlatformConfig } from "../config/load-platform-config.js";
import { createPrismaClient } from "../infrastructure/prisma/index.js";
import { seedLocalStandAccounts } from "./seed-local-stand-accounts.js";

const config = loadPlatformConfig();
if (
  config.mode !== "development" ||
  (config.identity.issuer !== "https://identity.inside.localhost:3301/oidc" &&
    !(
      config.identity.issuer === "https://identity.fullstack.test/oidc" &&
      process.env["FULLSTACK_WEB_BASE_URL"] !== undefined
    ))
)
  throw new Error(
    "Local stand account bootstrap requires the development stand",
  );
const subjects = z
  .object({
    owner: z.string().min(1),
    learner: z.string().min(1),
    learnerWithAccess: z.string().min(1),
  })
  .strict()
  .parse(JSON.parse(process.env["LOCAL_STAND_ACCOUNT_SUBJECTS"] ?? "null"));
const prisma = createPrismaClient(config.database.url);
try {
  process.stdout.write(
    `${JSON.stringify(await seedLocalStandAccounts(prisma, config.identity.issuer, subjects))}\n`,
  );
} finally {
  await prisma.$disconnect();
}
