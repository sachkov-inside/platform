import { z } from "zod";

import {
  passCells,
  configuredDeferralFacts,
} from "../../production/pass-config";
import { generatePassReport } from "../../production/pass-report";

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
