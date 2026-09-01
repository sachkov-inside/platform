import { describe, expect, test, vi } from "vitest";

import type { ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import type { ContentAccess } from "../../src/modules/content-access/index.js";
import type { MaterialAssets } from "../../src/modules/assets/index.js";
import { assembleMaterialAssetDelivery } from "../../src/modules/materials/features/deliver-material-asset/deliver-material-asset.js";
import { accountId as checkedAccountId } from "../../src/modules/accounts/index.js";

const materialId = "10000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000001";

describe("Material asset delivery", () => {
  test("serves public immutable bytes only after current ContentAccess allows", async () => {
    const read = vi.fn<ObjectStorage["read"]>().mockResolvedValue({
      body: new Uint8Array([1, 2, 3]),
      checksumSha256: "a".repeat(64),
      contentLength: 3,
      contentType: "image/webp",
    });
    const signGet = vi.fn<ObjectStorage["signGet"]>();
    const delivery = assembleMaterialAssetDelivery({
      assets: assetsFor({
        contentType: "image/webp",
        filename: "source.png",
        kind: "image",
        object: { protectedKey: "protected/image.webp", publicKey: "public/image.webp" },
        size: 3,
      }),
      contentAccess: accessDecision({
        checkedContentVersion: 2,
        decidedAt: new Date().toISOString(),
        decisionId: "public",
        effect: "allow",
        policyVersion: "content-access-v1",
        reason: "public_resource",
      }),
      objectStorage: storage({ read, signGet }),
      signedGetTtlSeconds: 60,
    });

    await expect(delivery.deliver({
      assetId,
      materialId,
      preview: false,
      subject: { kind: "anonymous" },
      variantWidth: 960,
    })).resolves.toMatchObject({
      ok: true,
      value: { cacheScope: "public-immutable", contentType: "image/webp", kind: "bytes" },
    });
    expect(read).toHaveBeenCalledWith("public", "public/image.webp");
    expect(signGet).not.toHaveBeenCalled();
  });

  test("returns a bounded protected attachment redirect and masks a denied asset", async () => {
    const signGet = vi.fn<ObjectStorage["signGet"]>().mockResolvedValue(
      "https://storage.yandexcloud.net/private/file?X-Amz-Expires=60",
    );
    const authorize = vi
      .fn<ContentAccess["authorize"]>()
      .mockResolvedValueOnce({
        checkedContentVersion: 2,
        decidedAt: new Date().toISOString(),
        decisionId: "member",
        effect: "allow",
        policyVersion: "content-access-v1",
        reason: "active_membership",
        validUntil: new Date(Date.now() + 60_000).toISOString(),
      })
      .mockResolvedValueOnce({
        decidedAt: new Date().toISOString(),
        decisionId: "denied",
        effect: "deny",
        policyVersion: "content-access-v1",
        reason: "membership_required",
      });
    const delivery = assembleMaterialAssetDelivery({
      assets: assetsFor({
        contentType: "application/pdf",
        filename: "План.pdf",
        kind: "file",
        object: { protectedKey: "protected/file", publicKey: "public/file" },
        size: 3,
      }),
      contentAccess: { authorize, checkAvailabilityMany: vi.fn() },
      objectStorage: storage({ signGet }),
      signedGetTtlSeconds: 60,
    });

    await expect(delivery.deliver({
      assetId,
      materialId,
      preview: false,
      subject: { kind: "account", accountId: checkedAccountId("30000000-0000-4000-8000-000000000001") },
    })).resolves.toMatchObject({
      ok: true,
      value: { cacheScope: "private-no-store", kind: "redirect" },
    });
    const signedInput = signGet.mock.calls[0]?.[0];
    expect(signedInput?.contentDisposition).toContain("filename*=UTF-8''");
    expect(signedInput).toMatchObject({ namespace: "protected", ttlSeconds: 60 });
    await expect(delivery.deliver({
      assetId,
      materialId,
      preview: false,
      subject: { kind: "anonymous" },
    })).resolves.toEqual({ error: { code: "asset_not_found" }, ok: false });
    expect(signGet).toHaveBeenCalledTimes(1);
  });
});

function assetsFor(
  values: Omit<NonNullable<Awaited<ReturnType<MaterialAssets["loadDelivery"]>>>, "assetId" | "materialId">,
): Pick<MaterialAssets, "loadDelivery"> {
  return {
    loadDelivery: () => Promise.resolve({ assetId, materialId, ...values }),
  };
}

function accessDecision(
  decision: Awaited<ReturnType<ContentAccess["authorize"]>>,
): ContentAccess {
  return {
    authorize: () => Promise.resolve(decision),
    checkAvailabilityMany: vi.fn(),
  };
}

function storage(overrides: Partial<ObjectStorage>): ObjectStorage {
  return {
    delete: vi.fn(),
    putImmutable: vi.fn(),
    read: vi.fn(),
    signGet: vi.fn(),
    ...overrides,
  };
}
