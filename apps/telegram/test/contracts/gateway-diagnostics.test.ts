import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { GatewayDiagnostics } from "../support/gateway-diagnostics.js";
import { jsonRecord } from "../support/json.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

it("retains command and cleanup phases after fixture removal without arguments, output or environment", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "gateway-diagnostics-"));
  directories.push(directory);
  const fixture = path.join(directory, "operation.json");
  const diagnostics = new GatewayDiagnostics(path.join(directory, "artifacts"));
  const secret = "private-sentinel";
  const result = diagnostics.run(
    "gateway",
    process.execPath,
    [
      "-e",
      `require('node:fs').writeFileSync(process.argv[1],JSON.stringify({phase:'migrate',status:'failed',private:'${secret}'}));console.log('${secret}');process.exit(19)`,
      fixture,
    ],
    { encoding: "utf8", env: { ...process.env, PRIVATE_TOKEN: secret } },
    fixture,
  );
  expect(result.status).toBe(19);
  rmSync(fixture);
  const report = readFileSync(diagnostics.reportPath, "utf8");
  expect(report).not.toContain(secret);
  expect(jsonRecord(report)).toMatchObject({
    commands: [
      {
        boundary: "gateway",
        status: 19,
        operationPhase: "migrate",
        lifecycle: [
          { phase: "supervisor-start" },
          { phase: "command-start" },
          { phase: "command-exit", status: 19 },
          { phase: "cleanup-start" },
          { phase: "cleanup-complete" },
        ],
      },
    ],
  });
});

it("does not attribute an unchanged prior operation phase to a rejected command", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "gateway-diagnostics-"));
  directories.push(directory);
  const operation = path.join(directory, "operation.json");
  writeFileSync(operation, '{"phase":"complete","status":"succeeded"}');
  const diagnostics = new GatewayDiagnostics(path.join(directory, "artifacts"));
  diagnostics.run(
    "gateway",
    process.execPath,
    ["-e", "process.exit(2)"],
    { encoding: "utf8" },
    operation,
  );
  expect(
    jsonRecord(readFileSync(diagnostics.reportPath, "utf8")),
  ).toMatchObject({ commands: [{ status: 2, operationPhase: "not-written" }] });
});
