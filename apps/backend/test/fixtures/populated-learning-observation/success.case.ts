import { afterAll, beforeAll, test } from "vitest";

import { reportLearningStage } from "../../integration/setup/populated-learning-observation.js";

beforeAll(() => {
  reportLearningStage("beforeAll", "start");
  reportLearningStage("database", "start");
  reportLearningStage("database", "end");
  reportLearningStage("beforeAll", "end");
});
afterAll(() => {
  reportLearningStage("cleanup", "start");
  reportLearningStage("cleanup:database", "start");
  reportLearningStage("cleanup:database", "end");
  reportLearningStage("cleanup", "end");
});
test("successful canary has no real fixture or provider", () => {
  reportLearningStage("accounts-http", "start");
  reportLearningStage("accounts-http", "end");
});
