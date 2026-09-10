import type { MultipartFile } from "@fastify/multipart";
import { HttpException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, test, vi } from "vitest";

import type { GuideArtifacts } from "../../src/modules/materials/facets/guide-artifacts/guide-artifacts.js";
import { GuideArtifactAuthoringController } from "../../src/modules/materials/facets/guide-artifacts/guide-artifacts.controller.js";
import type { GuideArtifactDelivery } from "../../src/modules/materials/features/deliver-guide-artifact/deliver-guide-artifact.js";
import { GuideArtifactReadController } from "../../src/modules/materials/features/deliver-guide-artifact/deliver-guide-artifact.controller.js";

const guideId = "10000000-0000-4000-8000-000000000001";
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
  guideIds: [guideId],
  materialIds: [],
  origin: "platform" as const,
  purpose: "Проверка",
  sourceId: null,
  title: "Чек-лист",
  updatedAt: "2026-09-09T00:00:00.000Z",
  version: 1,
};

describe("Guide Artifact HTTP controllers", () => {
  test("passes validated multipart metadata and the trusted actor to the facet", async () => {
    const create = vi
      .fn<GuideArtifacts["create"]>()
      .mockResolvedValue({ ok: true, value: artifact });
    const controller = authoringController({ create });

    await expect(
      controller.createFromFile(account, multipartRequest()),
    ).resolves.toMatchObject({ artifactId, version: 1 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: account.accountId,
        guideId,
        kind: "file",
        metadata: { access: "free", purpose: "Проверка", title: "Чек-лист" },
      }),
    );
  });

  test("maps every facet error to its exact problem status and code", async () => {
    const cases = [
      { code: "forbidden", status: 403 },
      { code: "artifact_not_found", status: 404 },
      { code: "guide_not_found", status: 404 },
      { code: "material_not_found", status: 404 },
      { code: "source_conflict", status: 409 },
      { code: "invalid_artifact", status: 422 },
      { code: "dependency_unavailable", status: 503 },
    ] as const;
    for (const { code, status } of cases) {
      const controller = authoringController({
        listForGuide: vi.fn<GuideArtifacts["listForGuide"]>().mockResolvedValue({
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The mapping table covers one error code per case.
          error: { code, retryable: true } as never,
          ok: false,
        }),
      });
      await expectHttpProblem(controller.list(account, guideId), status, code);
    }
  });

  test("reports a still referenced artifact with the Guides that hold it", async () => {
    const controller = authoringController({
      remove: vi.fn<GuideArtifacts["remove"]>().mockResolvedValue({
        error: { code: "artifact_referenced", guideIds: [guideId] },
        ok: false,
      }),
    });
    await expectHttpProblem(
      controller.remove(account, artifactId),
      409,
      "artifact_referenced",
      { guideIds: [guideId] },
    );
  });

  test("rejects a malformed delivery address before any access decision", async () => {
    const deliver = vi.fn<GuideArtifactDelivery["deliver"]>();
    const controller = new GuideArtifactReadController({
      deliver,
      read: vi.fn(),
    });

    await expectHttpProblem(
      controller.download(undefined, guideId, artifactId, "0", undefined),
      404,
      "artifact_not_found",
    );
    await expectHttpProblem(
      controller.download(undefined, guideId, "not-a-uuid", "1", undefined),
      404,
      "artifact_not_found",
    );
    await expectHttpProblem(
      controller.download(undefined, guideId, artifactId, "1", "maybe"),
      404,
      "artifact_not_found",
    );
    expect(deliver).not.toHaveBeenCalled();
  });

  test("maps a reader dependency failure to a no-detail service problem", async () => {
    const controller = new GuideArtifactReadController({
      deliver: vi.fn(),
      read: vi.fn<GuideArtifactDelivery["read"]>().mockResolvedValue({
        error: { code: "dependency_unavailable" },
        ok: false,
      }),
    });

    await expectHttpProblem(
      controller.read(undefined, guideId),
      503,
      "dependency_unavailable",
    );
  });
});

function authoringController(
  overrides: Partial<GuideArtifacts>,
): GuideArtifactAuthoringController {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Each case exercises one facet operation.
  return new GuideArtifactAuthoringController(overrides as GuideArtifacts);
}

function multipartRequest(): FastifyRequest {
  const fields = {
    access: { type: "field", value: "free" },
    checksumSha256: { type: "field", value: "a".repeat(64) },
    declaredSize: { type: "field", value: "3" },
    guideId: { type: "field", value: guideId },
    purpose: { type: "field", value: "Проверка" },
    title: { type: "field", value: "Чек-лист" },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The controller reads only this tested MultipartFile subset.
  const part = {
    fields,
    file: { truncated: false },
    filename: "checklist.md",
    mimetype: "text/markdown",
    toBuffer: () => Promise.resolve(Buffer.from("abc")),
  } as unknown as MultipartFile;
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
