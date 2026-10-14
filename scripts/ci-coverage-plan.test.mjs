// @ts-check
import assert from "node:assert/strict";
import { it } from "node:test";
import {
  normalizeCoverage,
  selectCoverage,
  validateGate,
} from "./ci-coverage-plan.mjs";
it("ordinary prose excludes application coverage explicitly", () => {
  assert.deepEqual(
    selectCoverage(["docs/research/idea.md"], "pull_request").required,
    ["docs"],
  );
});
it("queue selects the complete affected application and mixed changes union their consumers", () => {
  assert.deepEqual(
    selectCoverage(["apps/telegram/src/main.ts"], "merge_group").required,
    ["static", "unit", "telegram"],
  );
  const web = selectCoverage(["apps/web/src/app/page.tsx"], "merge_group");
  assert.ok(web.required.includes("fullstack"));
  assert.ok(web.required.includes("compose-production"));
  assert.ok(!web.required.includes("telegram"));
  assert.ok(
    selectCoverage(
      ["apps/web/a.ts", "apps/telegram/a.ts"],
      "merge_group",
    ).required.includes("telegram"),
  );
});
it("unknown, shared and runtime Markdown conservatively cover both applications", () => {
  for (const path of [
    "pnpm-lock.yaml",
    "scripts/new-command.sh",
    "packages/legal/src/terms.md",
    "docs/legal/offer.md",
    "unclassified",
  ]) {
    const plan = selectCoverage([path], "pull_request");
    assert.ok(plan.required.includes("telegram"), path);
    assert.ok(plan.required.includes("fullstack"), path);
  }
  assert.ok(
    selectCoverage(
      ["apps/backend/prompts/system.md"],
      "pull_request",
    ).required.includes("integration"),
  );
  assert.ok(
    selectCoverage(
      ["AGENTS.md", "docs/research/idea.md"],
      "pull_request",
    ).required.includes("contracts"),
  );
  assert.ok(
    selectCoverage(
      ["docs/research/idea.md", "apps/web/a.ts"],
      "pull_request",
    ).required.includes("ui"),
  );
});
it("gate rejects every required failure, cancellation, missing result and invalid plan", () => {
  const plan = selectCoverage(["apps/web/a.ts"], "merge_group");
  /** @type {Record<string, {result: string}>} */
  const results = { plan: { result: "success" } };
  for (const id of plan.required) results[id] = { result: "success" };
  for (const id of plan.excluded) results[id] = { result: "skipped" };
  assert.deepEqual(validateGate(plan, results).required, plan.required);
  for (const id of plan.required) {
    for (const result of ["failure", "cancelled", "skipped", ""])
      assert.throws(() => validateGate(plan, { ...results, [id]: { result } }));
    const missing = { ...results };
    delete missing[id];
    assert.throws(() => validateGate(plan, missing));
  }
  assert.throws(() => validateGate({ ...plan, required: [] }, results));
  assert.throws(() =>
    validateGate(
      { ...plan, required: [...plan.required, "invented"] },
      results,
    ),
  );
});
it("PR checks follow application consumers and all selected IDs have explicit exclusions", () => {
  assert.deepEqual(
    selectCoverage(["apps/web/page.tsx"], "pull_request").required,
    ["static", "unit", "ui", "web-e2e"],
  );
  assert.deepEqual(
    selectCoverage(["apps/backend/main.ts"], "pull_request").required,
    ["static", "unit", "integration", "integration-serial"],
  );
  assert.deepEqual(selectCoverage(["AGENTS.md"], "merge_group").required, [
    "docs",
    "contracts",
  ]);
  assert.deepEqual(
    selectCoverage(["apps/backend/main.ts"], "merge_group").required,
    [
      "static",
      "unit",
      "ui",
      "web-e2e",
      "integration",
      "integration-serial",
      "compose-development",
      "compose-production",
      "fullstack",
    ],
  );
});

it("shared CI execution inputs cover both consumers instead of only tooling contracts", () => {
  for (const path of [
    ".github/actions/setup-platform/action.yml",
    ".github/workflows/ci.yml",
    "scripts/ci-coverage-plan.mjs",
    "docs/contracts/notifications-v1/schema.json",
  ]) {
    const plan = selectCoverage([path], "pull_request");
    assert.ok(plan.categories.includes("shared"), path);
    assert.ok(plan.required.includes("fullstack"), path);
    assert.ok(plan.required.includes("telegram"), path);
  }
});

it("mixed application plans execute focused documentation and contract coverage once through their supersets", () => {
  for (const event of ["pull_request", "merge_group"]) {
    for (const runtime of [
      "apps/web/main.ts",
      "apps/backend/main.ts",
      "apps/telegram/main.ts",
      "pnpm-lock.yaml",
    ]) {
      const plan = selectCoverage(
        [runtime, "AGENTS.md", "docs/research/idea.md"],
        event,
      );
      assert.ok(plan.required.includes("static"));
      assert.ok(plan.required.includes("unit"));
      assert.ok(!plan.required.includes("docs"));
      assert.ok(!plan.required.includes("contracts"));
      assert.ok(plan.excluded.includes("docs"));
      assert.ok(plan.excluded.includes("contracts"));
    }
    assert.deepEqual(
      selectCoverage(["AGENTS.md", "docs/research/idea.md"], event).required,
      ["docs", "contracts"],
    );
  }
});

it("the gate rejects a redundant execution plan rather than silently accepting duplicate jobs", () => {
  const plan = selectCoverage(["apps/web/main.ts"], "pull_request");
  assert.throws(
    () =>
      validateGate(
        {
          ...plan,
          required: [...plan.required, "docs"],
          excluded: plan.excluded.filter((id) => id !== "docs"),
        },
        {},
      ),
    /superset/,
  );
});

it("missing coverage excludes only a focused check whose own superset will execute", () => {
  assert.deepEqual(normalizeCoverage(["docs", "unit"]), ["docs", "unit"]);
  assert.deepEqual(normalizeCoverage(["contracts", "static"]), [
    "contracts",
    "static",
  ]);
  assert.deepEqual(normalizeCoverage(["docs", "contracts"]), [
    "docs",
    "contracts",
  ]);
  assert.deepEqual(normalizeCoverage(["docs", "contracts", "static", "unit"]), [
    "static",
    "unit",
  ]);
});
