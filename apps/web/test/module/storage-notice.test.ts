import { expect, it } from "vitest";

import {
  storageNoticeKey,
  storageNoticeVisible,
} from "@/features/storage-notice";

it("shows the storage notice on the first visit and again for a new cookies edition", () => {
  expect(storageNoticeKey).toBe("inside.storage-notice.v1");
  expect(storageNoticeVisible(null, 2)).toBe(true);
  expect(storageNoticeVisible("1", 2)).toBe(true);
  expect(storageNoticeVisible("2", 2)).toBe(false);
});
