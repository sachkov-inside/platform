import { afterAll, beforeAll, expect, test } from "vitest";

import { reportLearningStage } from "../../integration/setup/populated-learning-observation.js";

beforeAll(async () => {
  reportLearningStage("beforeAll", "start");
  reportLearningStage("database", "start");
  reportLearningStage("database", "end");
  reportLearningStage("rustfs-start-health", "start");
  // This empty synthetic promise tests the reporter deadline, not a real resource (#2417).
  await new Promise<void>(() => undefined);
});
afterAll(() => {
  reportLearningStage("cleanup", "start");
  reportLearningStage("cleanup:database", "start");
  reportLearningStage("cleanup:database", "end");
  reportLearningStage("cleanup", "end");
});
test("real assertions are not reported passed after setup timeout", () => {
  expect.fail("A timed-out beforeAll must never execute the test body");
});
