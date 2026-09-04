import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import type { ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import { assembleSourceArchives } from "../../src/modules/workshop/infrastructure/object-storage/source-archives.js";

describe("SourceArchives", () => {
  test("stores immutable bytes under a private digest key and safely replays an existing object", async () => {
    const body = new TextEncoder().encode("synthetic starter archive");
    const digest = createHash("sha256").update(body).digest("hex");
    const putImmutable = vi
      .fn<ObjectStorage["putImmutable"]>()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "object_already_exists" },
      });
    const read = vi.fn<ObjectStorage["read"]>().mockResolvedValue({
      body,
      checksumSha256: digest,
      contentLength: body.byteLength,
      contentType: "application/gzip",
    });
    const storage: ObjectStorage = {
      putImmutable,
      read,
      delete: vi.fn(),
      signGet: vi.fn(),
    };
    const sourceArchives = assembleSourceArchives(storage);
    const input = {
      body,
      contentType: "application/gzip",
      retentionTime: "2031-01-04T00:00:00.000Z",
    };
    const expected = {
      ok: true,
      value: {
        key: `workshop/source-archives/${digest}`,
        digest,
        byteSize: body.byteLength,
        retentionTime: input.retentionTime,
      },
    };

    await expect(sourceArchives.store(input)).resolves.toEqual(expected);
    await expect(sourceArchives.store(input)).resolves.toEqual(expected);
    expect(putImmutable).toHaveBeenNthCalledWith(1, {
      body,
      checksumSha256: digest,
      contentType: input.contentType,
      key: expected.value.key,
      namespace: "protected",
    });
    expect(read).toHaveBeenCalledWith("protected", expected.value.key);
  });

  test("rejects empty or oversized archives before Object Storage I/O", async () => {
    const putImmutable = vi.fn<ObjectStorage["putImmutable"]>();
    const sourceArchives = assembleSourceArchives({
      putImmutable,
      read: vi.fn(),
      delete: vi.fn(),
      signGet: vi.fn(),
    });
    const base = {
      contentType: "application/gzip",
      retentionTime: "2031-01-04T00:00:00.000Z",
    };

    await expect(
      sourceArchives.store({ ...base, body: new Uint8Array() }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invalid_archive" },
    });
    await expect(
      sourceArchives.store({
        ...base,
        body: new Uint8Array(50 * 1024 * 1024 + 1),
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "invalid_archive" },
    });
    expect(putImmutable).not.toHaveBeenCalled();
  });
});
