import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import schema from "../../../../docs/contracts/notifications-v1/schema.json" with { type: "json" };
import fixtures from "../../../../docs/contracts/notifications-v1/fixtures.json" with { type: "json" };
import scenarios from "../../../../docs/contracts/notifications-v1/scenarios.json" with { type: "json" };
import manifest from "../../../../docs/contracts/notifications-v1/manifest.json" with { type: "json" };

const ajv = new Ajv({ strict: true, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(schema);

describe("notification integration artifacts (wire shape, not runtime conformance)", () => {
  for (const fixture of fixtures) {
    test(fixture.name, () => {
      const validate = ajv.compile({ $ref: `${schema.$id}#/definitions/${fixture.definition}` });
      expect(validate(fixture.value), JSON.stringify(validate.errors)).toBe(fixture.valid);
      expect(ajv.validate(schema.$id, fixture.value)).toBe(fixture.valid);
    });
  }

  test("both product sources and both delivery channels have valid examples", () => {
    const definitions = new Set(fixtures.filter((fixture) => fixture.valid).map((fixture) => fixture.definition));
    for (const definition of ["billingEvent", "materialEvent", "telegramDelivery", "emailDelivery", "unknownResult", "sentResult"])
      expect(definitions.has(definition), definition).toBe(true);
  });

  test("the portable bundle matches reviewed digests", () => {
    for (const [path, artifact] of Object.entries(manifest.artifacts)) {
      const bytes = readFileSync(new URL(`../../../../docs/contracts/notifications-v1/${path}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex"), path).toBe(artifact.sha256);
    }
  });

  test("normative sequence references resolve without pretending to run a provider", () => {
    const names = new Set(fixtures.map((fixture) => fixture.name));
    expect(names.size).toBe(fixtures.length);
    expect(new Set(scenarios.scenarios.map((scenario) => scenario.name)).size).toBe(scenarios.scenarios.length);
    for (const scenario of scenarios.scenarios) {
      expect(scenario.implementationTickets.length, scenario.name).toBeGreaterThan(0);
      for (const step of scenario.steps) {
        if ("fixture" in step && typeof step.fixture === "string") expect(names.has(step.fixture), scenario.name).toBe(true);
      }
    }
  });
});
