import { describe, expect, test, vi } from "vitest";

import type { MaterialAssets } from "../../src/modules/assets/index.js";
import { assembleMaterialAssetMaintenance } from "../../src/modules/materials/features/cleanup-material-assets/cleanup-material-assets.js";

describe("Material Asset maintenance", () => {
  test("runs cleanup with the configured grace and current Material references", async () => {
    const cleanupOrphans = vi.fn<MaterialAssets["cleanupOrphans"]>().mockImplementation(async ({ isReferenced }) => {
      await expect(isReferenced({ assetId: "asset", materialId: "material" })).resolves.toBe(true);
      return { ok: true, value: { cleaned: 2, retained: 1 } };
    });
    const containsAssetReference = vi.fn().mockResolvedValue({ ok: true, value: true });
    const maintenance = assembleMaterialAssetMaintenance({
      assets: { cleanupOrphans },
      config: { objectStorage: { orphanGraceMs: 86_400_000 } },
      materials: { containsAssetReference },
    });

    await expect(maintenance.cleanup()).resolves.toEqual({
      cleaned: 2,
      ok: true,
      retained: 1,
    });
    expect(cleanupOrphans).toHaveBeenCalledWith(expect.objectContaining({ graceMs: 86_400_000 }));
    expect(containsAssetReference).toHaveBeenCalledWith({ assetId: "asset", materialId: "material" });
  });

  test("returns a retryable failure for a durable worker retry", async () => {
    const maintenance = assembleMaterialAssetMaintenance({
      assets: { cleanupOrphans: vi.fn().mockRejectedValue(new Error("database unavailable")) },
      config: { objectStorage: { orphanGraceMs: 86_400_000 } },
      materials: { containsAssetReference: vi.fn() },
    });

    await expect(maintenance.cleanup()).resolves.toEqual({
      error: { code: "dependency_unavailable", retryable: true },
      ok: false,
    });
  });
});
