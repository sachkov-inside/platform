import { expect, it } from "vitest";
import {
  decodeStoredBroadcastAudience,
  decodeStoredSequenceDraft,
} from "../../src/modules/communications/historical-sequence-decoder.js";

it("reads an immutable historical publication through the current Sequence identity without mutating its snapshot", () => {
  const snapshot = {
    funnelId: "60000000-0000-4000-8000-000000000001",
    name: "Historical publication",
    isDefault: false,
    sources: [],
    steps: [],
    entryResponse: {
      stepId: "60000000-0000-4000-8000-000000000002",
      parts: [
        {
          partId: "60000000-0000-4000-8000-000000000003",
          content: {
            type: "text",
            text: "Historical message",
            entities: [],
            buttons: [],
          },
        },
      ],
    },
  };
  const original = JSON.stringify(snapshot);
  const { funnelId, ...facts } = snapshot;
  expect(decodeStoredSequenceDraft(snapshot)).toEqual({
    ...facts,
    sequenceId: funnelId,
  });
  expect(JSON.stringify(snapshot)).toBe(original);
  expect(() =>
    decodeStoredSequenceDraft({ ...snapshot, unexpected: true }),
  ).toThrow();
  expect(
    decodeStoredBroadcastAudience({ kind: "funnels", funnelIds: [funnelId] }),
  ).toEqual({ kind: "sequences", sequenceIds: [funnelId] });
});
