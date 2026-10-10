import { expect, it } from "vitest";
import { normalizeTelemetryRoute } from "../../src/modules/web-telemetry/index.js";

it("maps dynamic pages to templates and preserves a static sibling", () => {
  expect(normalizeTelemetryRoute("/products/secret/tasks/123")).toBe(
    "/products/[slug]/tasks/[code]",
  );
  expect(normalizeTelemetryRoute("/authoring/materials/new")).toBe(
    "/authoring/materials/new",
  );
  expect(normalizeTelemetryRoute("/materials/private-slug?token=secret")).toBe(
    "/materials/[slug]",
  );
  expect(normalizeTelemetryRoute("/unknown/account-id")).toBe("other");
});
