import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));

function expectSuccess(command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: backendRoot, encoding: "utf8" });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed while preparing a negative guardrail fixture\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

function expectFailure(command, arguments_, expectedDiagnostics) {
  const result = spawnSync(command, arguments_, {
    cwd: backendRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status === 0) {
    throw new Error(`${command} unexpectedly accepted a negative guardrail fixture`);
  }
  for (const diagnostic of expectedDiagnostics) {
    if (!output.includes(diagnostic)) {
      throw new Error(
        `${command} failed without expected diagnostic ${diagnostic}\n${output}`,
      );
    }
  }
}

expectFailure(
  "pnpm",
  [
    "exec",
    "tsc",
    "-p",
    "test/guardrails/fixtures/typescript/tsconfig.json",
    "--pretty",
    "false",
  ],
  [
    "TS2322",
    "TS2345",
    "account",
    "accounts.accounts",
    "material",
    "readingMaterialState",
    "accessGrant",
    "legacyClassification",
    "billingContact",
    "billingConsentEvidence",
    "notificationEmailAttempt",
    "telegramCommunityOperation",
    "material.published",
    "TS2375",
    "MaterialBodyResourceSummary",
    "Cannot find name 'describe'",
  ],
);

expectFailure(
  "pnpm",
  [
    "exec",
    "oxlint",
    "--no-ignore",
    "--type-aware",
    "--format",
    "json",
    "test/guardrails/fixtures/oxlint/guardrails.ts",
  ],
  [
    "no-restricted-imports",
    "framework or persistence internals",
    "typescript(switch-exhaustiveness-check)",
  ],
);

expectFailure(
  "node",
  [
    "scripts/check-backend-architecture.mjs",
    "test/guardrails/fixtures/architecture",
  ],
  [
    "capability index.ts",
    "membership-entitlements capability index.ts",
    "telegram-membership capability index.ts",
    "capability implementation cannot import Nest adapters",
    "material document blocks belong to the shared block registry",
    "a Guide capability is built by @inside/access-capabilities",
    "globalAccessCapabilities belongs to @inside/access-capabilities",
    "raw persistence imports",
    "Kysely is forbidden",
    "src/infrastructure/operational-readiness.ts",
    "src/infrastructure/operational-readiness.ts: application schema references must stay inside the owning Module (accounts.accounts)",
    "(pg)",
    "database table references must be schema-qualified",
    "database table references must stay inside the owning Module schema",
    "database table references must use statically declared identifiers",
    "application schema references must stay inside the owning Module",
    'accounts.accounts',
    'src/modules/notifications/infrastructure/foreign-schema.ts: database table references must stay inside the owning Module schema (billing.notification_outbox)',
    'src/modules/reading-activity/infrastructure/postgres/foreign-schema.ts: database table references must stay inside the owning Module schema (materials.published_materials)',
    'src/modules/bookmarks/infrastructure/postgres/foreign-schema.ts: database table references must stay inside the owning Module schema (materials.published_materials)',
  ],
);

// Инструмент, добавленный без `pnpm mcp:generate`, обязан ронять проверку и называть себя.
// Устаревший слепок снимается той же командой и правится здесь: перечня имён руками нет,
// а путь до слепка репозитория знает только сам скрипт.
const surfaceRoot = mkdtempSync(path.join(tmpdir(), "inside-mcp-tool-surface-"));
const staleSurfacePath = path.join(surfaceRoot, "tool-surface.json");
try {
  expectSuccess("pnpm", [
    "exec",
    "tsx",
    "scripts/mcp-tool-surface.ts",
    "--surface",
    staleSurfacePath,
  ]);
  const registered = JSON.parse(readFileSync(staleSurfacePath, "utf8"));
  const appearedTool = registered[0];
  if (appearedTool === undefined) {
    throw new Error("MCP tool surface fixture needs at least one registered tool");
  }
  const disappearedTool = "inside_tool_surface_probe";
  writeFileSync(
    staleSurfacePath,
    `${JSON.stringify([...registered.filter((name) => name !== appearedTool), disappearedTool].sort(), undefined, 2)}\n`,
  );

  expectFailure(
    "pnpm",
    ["exec", "tsx", "scripts/mcp-tool-surface.ts", "--check", "--surface", staleSurfacePath],
    [
      "MCP tool surface drift detected",
      `Appeared: ${appearedTool}`,
      `Disappeared: ${disappearedTool}`,
      "pnpm mcp:generate",
    ],
  );
} finally {
  rmSync(surfaceRoot, { force: true, recursive: true });
}

process.stdout.write("Negative TypeScript and architecture guardrails passed.\n");
