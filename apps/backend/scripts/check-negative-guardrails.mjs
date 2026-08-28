import { spawnSync } from "node:child_process";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));

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
    "MembershipEntitlements capability index.ts",
    "capability implementation cannot import Nest adapters",
    "raw persistence imports",
    "Kysely is forbidden",
    "src/infrastructure/operational-readiness.ts",
    "(pg)",
    "database table references must be schema-qualified",
    "database table references must stay inside the owning Module schema",
    "database table references must use statically declared identifiers",
    "application schema references must stay inside the owning Module",
    'accounts.accounts',
  ],
);

process.stdout.write("Negative TypeScript and architecture guardrails passed.\n");
