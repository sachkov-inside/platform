import { closeSync, openSync, writeSync } from "node:fs";
import { devNull } from "node:os";
import { afterAll, beforeAll, expect, test } from "vitest";

import { reportLearningStage } from "../../integration/setup/populated-learning-observation.js";

beforeAll(() => {
  // A physical fault in this isolated worker's own descriptor, never a module substitute (#2417).
  closeSync(2);
});
afterAll(() => {
  expect(openSync(devNull, "w")).toBe(2);
  process.stdout.write("CANARY_CLEANUP_COMPLETED\n");
});
test("diagnostic output cannot throw through cleanup when its own sink is closed", () => {
  expect(() => writeSync(2, "closed-descriptor-proof")).toThrow(/EBADF/u);
  process.stdout.write("CLOSED_STDERR_WAS_OBSERVED\n");
  expect(() => reportLearningStage("cleanup", "start")).not.toThrow();
  expect(() => reportLearningStage("cleanup:database", "failed")).not.toThrow();
  expect(() => reportLearningStage("cleanup", "end")).not.toThrow();
});
