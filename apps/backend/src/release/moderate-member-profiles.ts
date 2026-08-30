import { loadRepositoryEnvironment } from "../config/load-repository-environment.js";
import { parsePlatformConfig } from "../config/platform-config.js";
import { createPrismaClient } from "../infrastructure/prisma/index.js";
import {
  listOpenProfileReports,
  moderateMemberProfile,
  type ProfileModerationAction,
} from "../modules/member-profiles/index.js";

async function main(): Promise<void> {
  loadRepositoryEnvironment();
  const config = parsePlatformConfig(process.env);
  const prisma = createPrismaClient(config.database.url);
  try {
    const action = process.env.PROFILE_MODERATION_ACTION;
    if (action === "list") {
      process.stdout.write(`${JSON.stringify(await listOpenProfileReports(prisma))}\n`);
      return;
    }
    if (action !== "disable" && action !== "restore") {
      throw new Error(
        "PROFILE_MODERATION_ACTION must be list, disable or restore",
      );
    }
    const publicProfileId = requiredValue("PROFILE_PUBLIC_ID");
    const result = await moderateMemberProfile(
      prisma,
      publicProfileId,
      action satisfies ProfileModerationAction,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

function requiredValue(name: "PROFILE_PUBLIC_ID"): string {
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
