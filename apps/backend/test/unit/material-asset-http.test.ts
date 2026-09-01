import type { MultipartFile } from "@fastify/multipart";
import { HttpException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, test, vi } from "vitest";

import type { MaterialAssetDelivery } from "../../src/modules/materials/features/deliver-material-asset/deliver-material-asset.js";
import { DeliverMaterialAssetController } from "../../src/modules/materials/features/deliver-material-asset/deliver-material-asset.controller.js";
import type { MaterialAssetAuthoring } from "../../src/modules/materials/features/upload-material-asset/upload-material-asset.js";
import { UploadMaterialAssetController } from "../../src/modules/materials/features/upload-material-asset/upload-material-asset.controller.js";

const materialId = "10000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000001";
const account = { accountId: "30000000-0000-4000-8000-000000000001" };

describe("Material asset HTTP controllers", () => {
  test("passes validated multipart metadata and the bounded idempotency key to authoring", async () => {
    const upload = vi.fn<MaterialAssetAuthoring["upload"]>().mockResolvedValue({
      ok: true,
      value: {
        assetId,
        contentType: "application/pdf",
        filename: "guide.pdf",
        kind: "file",
        size: 3,
        state: "ready",
      },
    });
    const controller = new UploadMaterialAssetController({ upload });

    await expect(controller.upload(
      account,
      materialId,
      "request-1",
      multipartRequest(),
    )).resolves.toMatchObject({ assetId, state: "ready" });
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      actor: account.accountId,
      body: Buffer.from("pdf"),
      declaredContentType: "application/pdf",
      declaredSize: 3,
      idempotencyKey: "request-1",
      kind: "file",
      materialId,
    }));
  });

  test("maps invalid upload input and application dependency failures to exact problems", async () => {
    const upload = vi.fn<MaterialAssetAuthoring["upload"]>().mockResolvedValue({
      error: { code: "dependency_unavailable" },
      ok: false,
    });
    const controller = new UploadMaterialAssetController({ upload });

    await expectHttpProblem(
      controller.upload(account, materialId, "x".repeat(129), multipartRequest()),
      400,
      "invalid_upload",
    );
    await expectHttpProblem(
      controller.upload(account, materialId, "request-2", multipartRequest()),
      503,
      "dependency_unavailable",
    );

    const unsupportedFileController = new UploadMaterialAssetController({
      upload: vi.fn<MaterialAssetAuthoring["upload"]>().mockResolvedValue({
        error: { code: "unsupported_file_type" },
        ok: false,
      }),
    });
    await expectHttpProblem(
      unsupportedFileController.upload(account, materialId, "request-3", multipartRequest()),
      422,
      "unsupported_file_type",
    );
  });

  test("requires an exact current content version and preview boolean before delivery", async () => {
    const deliver = vi.fn<MaterialAssetDelivery["deliver"]>().mockResolvedValue({
      ok: true,
      value: {
        cacheScope: "private-no-store",
        kind: "redirect",
        location: "https://storage.example.test/signed",
      },
    });
    const controller = new DeliverMaterialAssetController({ deliver });

    await expect(controller.download(undefined, materialId, assetId, "7", "true"))
      .resolves.toMatchObject({ kind: "redirect" });
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      assetId,
      contentVersion: 7,
      materialId,
      preview: true,
      subject: { kind: "anonymous" },
    }));
    await expectHttpProblem(
      controller.download(undefined, materialId, assetId, "7", "yes"),
      404,
      "asset_not_found",
    );
    await expectHttpProblem(
      controller.download(undefined, materialId, assetId, undefined, undefined),
      404,
      "asset_not_found",
    );
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  test("maps delivery dependency failure to a no-detail service problem", async () => {
    const controller = new DeliverMaterialAssetController({
      deliver: vi.fn().mockResolvedValue({
        error: { code: "dependency_unavailable" },
        ok: false,
      }),
    });

    await expectHttpProblem(
      controller.image(account, materialId, assetId, "960", "7", "false"),
      503,
      "dependency_unavailable",
    );
  });
});

function multipartRequest(): FastifyRequest {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The controller reads only this tested MultipartFile subset.
  const part = {
    fields: {
      checksumSha256: { type: "field", value: "a".repeat(64) },
      declaredSize: { type: "field", value: "3" },
      kind: { type: "field", value: "file" },
    },
    file: { truncated: false },
    filename: "guide.pdf",
    mimetype: "application/pdf",
    toBuffer: () => Promise.resolve(Buffer.from("pdf")),
  } as unknown as MultipartFile;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The controller reads only request.file from this transport fixture.
  return { file: vi.fn().mockResolvedValue(part) } as unknown as FastifyRequest;
}

async function expectHttpProblem(
  promise: unknown,
  status: number,
  code: string,
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected an HTTP problem");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    if (!(error instanceof HttpException)) throw error;
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code, status });
  }
}
