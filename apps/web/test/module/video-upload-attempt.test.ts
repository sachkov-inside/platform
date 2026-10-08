import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBrowserVideoUploadAttempt,
  clearRecoveredBrowserVideoUploadAttempt,
  getOrCreateBrowserVideoUploadAttempt,
  recordBrowserVideoUploadAttempt,
} from "@/features/material-video/api/video-upload-attempt.browser";

const materialId = "10000000-0000-4000-8000-000000000001";
const videoId = "20000000-0000-4000-8000-000000000001";
const otherVideoId = "20000000-0000-4000-8000-000000000002";
const file = new File(["Video bytes"], "repeat.mp4", {
  lastModified: 123,
  type: "video/mp4",
});

function installStorage(): Storage {
  const values = new Map<string, string>();
  const storage: Storage = {
    clear: () => {
      values.clear();
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}

afterEach(() => vi.unstubAllGlobals());

describe("Browser Video upload attempts", () => {
  it("starts a new attempt for the same file after its recovered Video is removed", async () => {
    installStorage();
    const first = await getOrCreateBrowserVideoUploadAttempt(materialId, file);
    recordBrowserVideoUploadAttempt(first, videoId);
    expect(
      await getOrCreateBrowserVideoUploadAttempt(materialId, file),
    ).toMatchObject({
      submissionId: first.submissionId,
    });

    clearRecoveredBrowserVideoUploadAttempt(materialId, videoId);

    const restarted = await getOrCreateBrowserVideoUploadAttempt(
      materialId,
      file,
    );
    expect(restarted.submissionId).not.toBe(first.submissionId);
    expect(
      await getOrCreateBrowserVideoUploadAttempt(materialId, file),
    ).toMatchObject({
      submissionId: restarted.submissionId,
    });
  });

  it("retires legacy keys without Video identity only for the removed Material", async () => {
    installStorage();
    const legacy = await getOrCreateBrowserVideoUploadAttempt(materialId, file);
    const otherMaterial = await getOrCreateBrowserVideoUploadAttempt(
      "other-material",
      file,
    );
    clearRecoveredBrowserVideoUploadAttempt(materialId, videoId);
    expect(
      (await getOrCreateBrowserVideoUploadAttempt(materialId, file))
        .submissionId,
    ).not.toBe(legacy.submissionId);
    expect(
      (await getOrCreateBrowserVideoUploadAttempt("other-material", file))
        .submissionId,
    ).toBe(otherMaterial.submissionId);
  });

  it("preserves identified attempts for other Videos of the same Material", async () => {
    installStorage();
    const first = await getOrCreateBrowserVideoUploadAttempt(materialId, file);
    recordBrowserVideoUploadAttempt(first, videoId);
    const otherFile = new File(["Other bytes"], "other.mp4", {
      lastModified: 456,
    });
    const other = await getOrCreateBrowserVideoUploadAttempt(
      materialId,
      otherFile,
    );
    recordBrowserVideoUploadAttempt(other, otherVideoId);
    clearRecoveredBrowserVideoUploadAttempt(materialId, videoId);
    expect(
      (await getOrCreateBrowserVideoUploadAttempt(materialId, otherFile))
        .submissionId,
    ).toBe(other.submissionId);
  });

  it("does not overwrite or clear a newer attempt when an older response arrives", async () => {
    installStorage();
    const first = await getOrCreateBrowserVideoUploadAttempt(materialId, file);
    clearBrowserVideoUploadAttempt(first);
    const newer = await getOrCreateBrowserVideoUploadAttempt(materialId, file);
    recordBrowserVideoUploadAttempt(newer, otherVideoId);
    recordBrowserVideoUploadAttempt(first, videoId);
    clearBrowserVideoUploadAttempt(first);
    clearRecoveredBrowserVideoUploadAttempt(materialId, videoId);
    expect(
      (await getOrCreateBrowserVideoUploadAttempt(materialId, file))
        .submissionId,
    ).toBe(newer.submissionId);
  });

  it("keeps an unsettled same-file retry on its original submission", async () => {
    installStorage();
    const first = await getOrCreateBrowserVideoUploadAttempt(materialId, file);
    expect(
      (await getOrCreateBrowserVideoUploadAttempt(materialId, file))
        .submissionId,
    ).toBe(first.submissionId);
    recordBrowserVideoUploadAttempt(first, videoId);
    expect(
      (await getOrCreateBrowserVideoUploadAttempt(materialId, file))
        .submissionId,
    ).toBe(first.submissionId);
  });

  it("keeps uploads available when browser storage is denied", async () => {
    const storage = installStorage();
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("Storage denied");
    });
    const attempt = await getOrCreateBrowserVideoUploadAttempt(
      materialId,
      file,
    );
    expect(attempt.submissionId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(() => {
      recordBrowserVideoUploadAttempt(attempt, videoId);
    }).not.toThrow();
    expect(() => {
      clearRecoveredBrowserVideoUploadAttempt(materialId, videoId);
    }).not.toThrow();
    expect(() => {
      clearBrowserVideoUploadAttempt(attempt);
    }).not.toThrow();
  });
});
