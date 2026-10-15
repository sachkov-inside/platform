import multipart, { type MultipartFile } from "@fastify/multipart";
import Fastify from "fastify";
import { createHash } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, test, vi } from "vitest";

import type { ProductArtifacts } from "../../src/modules/materials/facets/product-artifacts/product-artifacts.js";
import { ProductArtifactAuthoringController } from "../../src/modules/materials/facets/product-artifacts/product-artifacts.controller.js";
import type { ProductArtifactDelivery } from "../../src/modules/materials/features/deliver-product-artifact/deliver-product-artifact.js";
import { ProductArtifactReadController } from "../../src/modules/materials/features/deliver-product-artifact/deliver-product-artifact.controller.js";

const productId = "10000000-0000-4000-8000-000000000001";
const artifactId = "20000000-0000-4000-8000-000000000001";
const account = { accountId: "30000000-0000-4000-8000-000000000001" };
const artifact = {
  access: "free" as const,
  archived: false,
  artifactId,
  content: {
    contentType: "text/markdown",
    filename: "checklist.md",
    kind: "file" as const,
    size: 3,
  },
  productIds: [productId],
  materialIds: [],
  origin: "platform" as const,
  purpose: "Проверка",
  sourceId: null,
  title: "Чек-лист",
  updatedAt: "2026-09-09T00:00:00.000Z",
  version: 1,
};

describe("Product Artifact HTTP controllers", () => {
  test("imports a real multipart Markdown artifact beyond the API default part budget", async () => {
    const sourceId = "inside-content:aie-customer-brief";
    const productSourceId = "inside-content:inside-ai-engineering";
    const outcome = {
      artifactId,
      outcome: "created" as const,
      sourceId,
      title: "Бриф заказчика (.md)",
    };
    const apply = vi
      .fn<ProductArtifacts["applyAuthoringImport"]>()
      .mockResolvedValue({ ok: true, value: { outcomes: [outcome] } });
    const controller = authoringController({ applyAuthoringImport: apply });
    const server = Fastify();
    // The API has a small global budget; each upload must declare its full form budget.
    await server.register(multipart, {
      limits: { fields: 4, files: 1, parts: 5 },
    });
    server.post("/import", async (request, reply) => {
      try {
        return await reply
          .code(201)
          .send(await controller.importFromSource(account, productId, request));
      } catch (error) {
        if (error instanceof HttpException)
          return await reply.code(error.getStatus()).send(error.getResponse());
        throw error;
      }
    });
    try {
      const bytes = new TextEncoder().encode(
        "# Бриф заказчика\n\nТребования компании.\n",
      );
      const form = new FormData();
      for (const [name, value] of Object.entries({
        productSourceId,
        sourceId,
        title: outcome.title,
        purpose: "",
        access: "closed",
        declaredSize: String(bytes.length),
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      }))
        form.set(name, value);
      form.set(
        "file",
        new Blob([bytes], { type: "text/markdown" }),
        "customer-brief.md",
      );
      const request = new Request("http://inside.local/import", {
        method: "POST",
        body: form,
      });
      const response = await server.inject({
        method: "POST",
        url: "/import",
        headers: { "content-type": request.headers.get("content-type") ?? "" },
        payload: Buffer.from(await request.arrayBuffer()),
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toEqual(outcome);
      const submitted = apply.mock.calls[0]?.[0];
      expect(submitted).toMatchObject({
        actor: account.accountId,
        productId,
        productSourceId,
      });
      expect(submitted?.artifacts[0]).toMatchObject({
        sourceId,
        access: "closed",
        purpose: "",
      });
      expect(submitted?.artifacts[0]?.file).toMatchObject({
        filename: "customer-brief.md",
        declaredContentType: "text/markdown",
        body: Buffer.from(bytes),
      });
    } finally {
      await server.close();
    }
  });

  test("passes validated multipart metadata and the trusted actor to the facet", async () => {
    const create = vi
      .fn<ProductArtifacts["create"]>()
      .mockResolvedValue({ ok: true, value: artifact });
    const controller = authoringController({ create });

    await expect(
      controller.createFromFile(account, multipartRequest()),
    ).resolves.toMatchObject({ artifactId, version: 1 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: account.accountId,
        productId,
        kind: "file",
        metadata: { access: "free", purpose: "Проверка", title: "Чек-лист" },
      }),
    );
  });

  test("reads a link Product Artifact name with the facet's own rule", async () => {
    const create = vi
      .fn<ProductArtifacts["create"]>()
      .mockResolvedValue({ ok: true, value: artifact });
    const controller = authoringController({ create });
    const body = {
      access: "free",
      externalUrl: "https://example.com/checklist",
      productId,
      purpose: " Проверка ",
      title: "  Чек-лист ",
    };

    await controller.createFromLink(account, body);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { access: "free", purpose: "Проверка", title: "Чек-лист" },
      }),
    );
    await expectHttpProblem(
      controller.createFromLink(account, { ...body, title: "   " }),
      422,
      "invalid_artifact",
    );
    expect(create).toHaveBeenCalledOnce();
  });

  test("maps every facet error to its exact problem status and code", async () => {
    const cases = [
      { code: "forbidden", status: 403 },
      { code: "artifact_not_found", status: 404 },
      { code: "product_not_found", status: 404 },
      { code: "material_not_found", status: 404 },
      { code: "source_conflict", status: 409 },
      { code: "invalid_artifact", status: 422 },
      { code: "dependency_unavailable", status: 503 },
    ] as const;
    for (const { code, status } of cases) {
      const controller = authoringController({
        listForProduct: vi
          .fn<ProductArtifacts["listForProduct"]>()
          .mockResolvedValue({
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The mapping table covers one error code per case.
            error: { code, retryable: true } as never,
            ok: false,
          }),
      });
      await expectHttpProblem(
        controller.list(account, productId),
        status,
        code,
      );
    }
  });

  test("reports a still referenced artifact with the Products that hold it", async () => {
    const controller = authoringController({
      remove: vi.fn<ProductArtifacts["remove"]>().mockResolvedValue({
        error: { code: "artifact_referenced", productIds: [productId] },
        ok: false,
      }),
    });
    await expectHttpProblem(
      controller.remove(account, artifactId),
      409,
      "artifact_referenced",
      { productIds: [productId] },
    );
  });

  test("rejects a malformed delivery address before any access decision", async () => {
    const deliver = vi.fn<ProductArtifactDelivery["deliver"]>();
    const controller = new ProductArtifactReadController({
      deliver,
      read: vi.fn(),
    });

    await expectHttpProblem(
      controller.download(undefined, productId, artifactId, "0", undefined),
      404,
      "artifact_not_found",
    );
    await expectHttpProblem(
      controller.download(undefined, productId, "not-a-uuid", "1", undefined),
      404,
      "artifact_not_found",
    );
    await expectHttpProblem(
      controller.download(undefined, productId, artifactId, "1", "maybe"),
      404,
      "artifact_not_found",
    );
    expect(deliver).not.toHaveBeenCalled();
  });

  test("maps a reader dependency failure to a no-detail service problem", async () => {
    const controller = new ProductArtifactReadController({
      deliver: vi.fn(),
      read: vi.fn<ProductArtifactDelivery["read"]>().mockResolvedValue({
        error: { code: "dependency_unavailable" },
        ok: false,
      }),
    });

    await expectHttpProblem(
      controller.read(undefined, productId),
      503,
      "dependency_unavailable",
    );
  });
});

function authoringController(
  overrides: Partial<ProductArtifacts>,
): ProductArtifactAuthoringController {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Each case exercises one facet operation.
  return new ProductArtifactAuthoringController(overrides as ProductArtifacts);
}

function multipartRequest(): FastifyRequest {
  const fields = {
    access: { type: "field", value: "free" },
    checksumSha256: { type: "field", value: "a".repeat(64) },
    declaredSize: { type: "field", value: "3" },
    productId: { type: "field", value: productId },
    purpose: { type: "field", value: "Проверка" },
    title: { type: "field", value: "Чек-лист" },
  };
  const partFixture = {
    fields,
    file: { truncated: false },
    filename: "checklist.md",
    mimetype: "text/markdown",
    toBuffer: () => Promise.resolve(Buffer.from("abc")),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The controller reads only this tested MultipartFile subset.
  const part = partFixture as unknown as MultipartFile;
  // The fixture enforces the declared multipart limits, so a form that carries
  // more fields than the controller allows fails here instead of in production.
  const file = vi.fn((options?: { limits?: { fields?: number } }) => {
    const allowed = options?.limits?.fields ?? 0;
    return Object.keys(fields).length > allowed
      ? Promise.reject(new Error("FieldsLimitError"))
      : Promise.resolve(part);
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The controller reads only request.file from this transport fixture.
  return { file } as unknown as FastifyRequest;
}

async function expectHttpProblem(
  promise: unknown,
  status: number,
  code: string,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected an HTTP problem");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    if (!(error instanceof HttpException)) throw error;
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code, status, ...extra });
  }
}
