import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import {
  passCells,
  configuredDeferralFacts,
} from "../../production/pass-config";
import { generatePassReport } from "../../production/pass-report";

// Leave a real descendant behind on both CLI success and failure. The contract runner's
// existing ownership supervisor must reap it before returning the report's exit status.
if (process.env["PRODUCTION_PASS_FIXTURE_DESCENDANT"] === "true") {
  const directory = z
    .string()
    .parse(process.env["PRODUCTION_ACCESS_REPORT_DIR"]);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  if (child.pid === undefined)
    throw new Error("Fixture descendant did not start");
  process.kill(child.pid, 0);
  writeFileSync(join(directory, "descendant.pid"), String(child.pid));
  child.unref();
}

const scenario = z
  .enum([
    "valid",
    "ready",
    "free-practice-ready",
    "expired",
    "incomplete",
    "missing",
    "empty",
    "no-observations",
  ])
  .parse(process.argv[2]);
const live = passCells.find(
  ({ id }) => id === "learner-product-a/read-product-a/body@browser",
);
const deferred = passCells.find(
  ({ id }) =>
    id ===
    (scenario === "free-practice-ready"
      ? "account-without-entitlement/read-free-practice/practice@learner-mcp"
      : "learner-product-a/read-product-b/body@browser"),
);
if (live === undefined || deferred === undefined)
  throw new Error("Missing fixture cells");
const { deferral: _policy, ...incomplete } = deferred;
generatePassReport({
  cells:
    scenario === "empty"
      ? []
      : [live, scenario === "incomplete" ? incomplete : deferred],
  deferralFacts:
    scenario === "missing"
      ? {}
      : configuredDeferralFacts({
          productB:
            scenario === "ready" ? { id: "fixture", slug: "fixture" } : null,
          freeTaskCode:
            scenario === "free-practice-ready" ? "current-free-practice" : null,
        }),
  evaluatedAt:
    scenario === "expired" ? "2026-11-30T00:00:00Z" : "2026-10-30T12:00:00Z",
});
