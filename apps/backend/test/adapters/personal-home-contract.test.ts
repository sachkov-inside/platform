import { describe, expect, test } from "vitest";

import { learningHomeHttpSchema } from "../../src/modules/reading-activity/features/get-learning-home/get-learning-home.controller.js";
import { seriesContinuationHttpSchema } from "../../src/modules/reading-activity/features/get-series-continuation/get-series-continuation.controller.js";

// The personal home reaches its readers through strict schemas, so one key the projection never
// declared costs an account the whole body: it sees a Guide it has started as if it had not.
// `reading-activity-http.test.ts` reads the live responses with these schemas, and that check is
// only worth its place while an undeclared key still fails them.
describe("personal home response contract", () => {
  const continuation = {
    collection: { cover: null, count: 3, id: "5a1c6f10-0b33-4e2f-9a8c-7d4e12b0f001", name: "Demo · Прогресс обучения", previewItems: [], slug: "demo-progress-series", summary: null },
    read: 1,
    total: 3,
    continuation: { materialSlug: "video-pro-developer-pipeline", resume: { kind: "start" } },
  };

  test("accepts the Guide continuation the module publishes", () => {
    expect(seriesContinuationHttpSchema.safeParse(continuation).error?.issues ?? []).toEqual([]);
    expect(learningHomeHttpSchema.safeParse({ video: null, series: continuation }).error?.issues ?? []).toEqual([]);
  });

  test("rejects a Guide field the collection does not declare", () => {
    const leaked = { ...continuation, collection: { ...continuation.collection, introduction: null } };
    expect(seriesContinuationHttpSchema.safeParse(leaked).success).toBe(false);
    expect(learningHomeHttpSchema.safeParse({ video: null, series: leaked }).success).toBe(false);
  });
});
