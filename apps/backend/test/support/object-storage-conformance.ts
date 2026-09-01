import { describe, expect, test } from "vitest";

import type { ObjectStorage } from "../../src/infrastructure/object-storage/index.js";

export function objectStorageConformance(
  name: string,
  createStorage: () => Promise<ObjectStorage> | ObjectStorage,
) {
  describe(name, () => {
    test("round-trips immutable bytes and refuses overwrite", async () => {
      const storage = await createStorage();
      const key = `assets/${crypto.randomUUID()}/file.pdf`;
      const first = await storage.putImmutable({
        body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        checksumSha256: "9670f34a736a67bdc89b33fe0d13b5b100c4e4f65c1c7032b8387412fe6e55fc",
        contentType: "application/pdf",
        key,
        namespace: "quarantine",
      });
      expect(first).toEqual({ ok: true });
      await expect(
        storage.putImmutable({
          body: new Uint8Array([0]),
          checksumSha256: "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
          contentType: "application/octet-stream",
          key,
          namespace: "quarantine",
        }),
      ).resolves.toEqual({ error: { code: "object_already_exists" }, ok: false });
      await expect(storage.read("quarantine", key)).resolves.toEqual({
        body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        checksumSha256: "9670f34a736a67bdc89b33fe0d13b5b100c4e4f65c1c7032b8387412fe6e55fc",
        contentLength: 4,
        contentType: "application/pdf",
      });
    });

    test("creates only bounded protected download credentials", async () => {
      const storage = await createStorage();
      await expect(
        storage.signGet({
          contentDisposition: 'attachment; filename="guide.pdf"',
          contentType: "application/pdf",
          key: "assets/9fb8d4e2/file.pdf",
          namespace: "protected",
          ttlSeconds: 301,
        }),
      ).rejects.toThrow("ttlSeconds must be between 1 and 300");
      const signed = await storage.signGet({
        key: "assets/9fb8d4e2/file.pdf",
        namespace: "protected",
        ttlSeconds: 120,
      });
      const url = new URL(signed);
      expect(
        url.searchParams.get("ttl") ?? url.searchParams.get("X-Amz-Expires"),
      ).toBe("120");
    });
  });
}
