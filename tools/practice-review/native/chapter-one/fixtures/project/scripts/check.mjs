import { spawnSync } from "node:child_process";
for (const args of [
  [
    "node_modules/oxlint/bin/oxlint",
    "--config",
    ".oxlintrc.json",
    "apps",
    "scripts",
  ],
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
  [
    "node_modules/prettier/bin/prettier.cjs",
    "--check",
    "apps",
    "scripts",
    "package.json",
    "tsconfig.json",
  ],
  ["--test", "apps/backend/health.test.mjs"],
  ["scripts/build.mjs"],
  ["scripts/integration.mjs"],
  ["scripts/browser.mjs"],
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
