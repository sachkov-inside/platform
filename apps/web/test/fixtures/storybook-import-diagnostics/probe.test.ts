import { expect, it } from "vitest";
import { value } from "./story-dependency";

it("loads after setup", async () => {
  expect(document.documentElement.dataset["importProbeSetup"]).toBe("executed");
  expect(value).toBe("ready");
  const nonModuleError = await fetch(
    "/__non-module-error?token=private-fixture-marker",
  );
  expect(nonModuleError.status).toBe(404);
});
