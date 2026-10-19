import { expect, test } from "vitest";
import { broadcastSchema } from "@/_pages/communications/model/broadcasts";
test("communications reads an explicit waitlist broadcast without replacing its audience", () => {
  const broadcast = {
    broadcastId: "10000000-0000-4000-8000-000000000001",
    revision: 1,
    state: "draft",
    parts: [],
    scheduledAt: null,
    audienceSnapshotId: null,
    snapshotSize: 0,
    audience: {
      kind: "waitlist",
      intakeId: "d4f674dc-a1a9-4f86-8855-e4d904d2845f",
    },
  };
  expect(broadcastSchema.parse(broadcast).audience).toEqual(broadcast.audience);
});
