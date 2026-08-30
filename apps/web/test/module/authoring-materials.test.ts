import { describe, expect, it, vi } from "vitest";

import {
  getAuthoringMaterials,
  type AuthoringMaterialsDependencies,
} from "@/_pages/authoring-materials/api/get-authoring-materials";
import { parseAuthoringMaterialsQuery } from "@/_pages/authoring-materials/model/authoring-materials-query";
import {
  parseAuthoringReturnHref,
  withAuthoringReturnHref,
} from "@/features/material-authoring";
import { BackendConnectionError } from "@/shared/api/backend/index.server";

const materialId = "96000000-0000-4000-8000-000000000001";

describe("Authoring Materials server adapter", () => {
  it("normalizes URL search, filter, and pagination without trusting repeated values", () => {
    expect(
      parseAuthoringMaterialsQuery({
        page: "2",
        search: "  platform   inside ",
        state: "unpublished",
      }),
    ).toEqual({
      page: 2,
      publicationState: "unpublished",
      search: "platform inside",
    });
    expect(
      parseAuthoringMaterialsQuery({
        page: "not-a-page",
        search: ["ignored", "repeated"],
        state: "all",
      }),
    ).toEqual({ page: 1 });
  });

  it("accepts only the bounded Materials list as an Editor return destination", () => {
    expect(
      parseAuthoringReturnHref(
        "/authoring/materials?search=Platform&state=draft&page=2",
      ),
    ).toBe("/authoring/materials?search=Platform&state=draft&page=2");
    expect(parseAuthoringReturnHref("https://attacker.example/materials")).toBe(
      "/authoring/materials",
    );
    expect(parseAuthoringReturnHref("/authoring/materials/new")).toBe(
      "/authoring/materials",
    );
    expect(
      withAuthoringReturnHref(
        `/authoring/materials/${materialId}/preview`,
        "/authoring/materials?state=unpublished&page=2",
      ),
    ).toBe(
      `/authoring/materials/${materialId}/preview?from=%2Fauthoring%2Fmaterials%3Fstate%3Dunpublished%26page%3D2`,
    );
  });

  it("maps one protected corpus page to the presentation contract", async () => {
    const dependencies = {
      list: vi.fn().mockResolvedValue({
        body: {
          items: [
            {
              contentVersion: 7,
              format: { id: "96000000-0000-4000-8000-000000000002", name: "Гайд" },
              materialId,
              publicationState: "published",
              title: "Управляемый Material",
              topic: { id: "96000000-0000-4000-8000-000000000003", name: "Platform" },
              updatedAt: "2026-08-30T10:00:00.000Z",
            },
          ],
          page: 2,
          pageSize: 20,
          totalItems: 21,
          totalPages: 2,
        },
        ok: true,
        response: Response.json({}),
      }),
    } satisfies AuthoringMaterialsDependencies;

    await expect(
      getAuthoringMaterials(
        {
          page: 2,
          publicationState: "published",
          search: "Управляемый",
        },
        "access-token",
        dependencies,
      ),
    ).resolves.toEqual({
      kind: "ready",
      items: [
        {
          format: "Гайд",
          materialId,
          publicationState: "published",
          title: "Управляемый Material",
          topic: "Platform",
          updatedAt: "2026-08-30T10:00:00.000Z",
        },
      ],
      page: 2,
      pageSize: 20,
      totalItems: 21,
      totalPages: 2,
    });
    expect(dependencies.list).toHaveBeenCalledWith(
      {
        page: 2,
        publicationState: "published",
        search: "Управляемый",
      },
      "access-token",
    );
  });

  it.each([
    {
      expected: { kind: "signed_out" },
      problem: { code: "unauthorized" },
      status: 401,
    },
    {
      expected: { kind: "forbidden" },
      problem: { code: "forbidden" },
      status: 403,
    },
    {
      expected: { kind: "unavailable", reference: "pg-offline" },
      problem: { code: "dependency_unavailable", correlationId: "pg-offline" },
      status: 503,
    },
    {
      expected: { kind: "unexpected_error", reference: "read-failed" },
      problem: { code: "internal_error", correlationId: "read-failed" },
      status: 500,
    },
    {
      expected: { kind: "malformed_response" },
      problem: { code: "teapot" },
      status: 418,
    },
  ])("maps HTTP $status to $expected.kind", async ({ expected, problem, status }) => {
    const dependencies = {
      list: vi.fn().mockResolvedValue({
        ok: false,
        problem,
        response: Response.json(problem, { status }),
      }),
    } satisfies AuthoringMaterialsDependencies;

    await expect(
      getAuthoringMaterials({ page: 1 }, "access-token", dependencies),
    ).resolves.toEqual(expected);
  });

  it("fails closed for malformed success bodies and typed transport failures", async () => {
    await expect(
      getAuthoringMaterials({ page: 1 }, "access-token", {
        list: vi.fn().mockResolvedValue({
          body: { items: "not-an-array" },
          ok: true,
          response: Response.json({}),
        }),
      }),
    ).resolves.toEqual({ kind: "malformed_response" });
    await expect(
      getAuthoringMaterials({ page: 1 }, "access-token", {
        list: vi.fn().mockRejectedValue(
          new BackendConnectionError("unavailable", "backend offline"),
        ),
      }),
    ).resolves.toEqual({ kind: "unavailable", reference: "unavailable" });
    await expect(
      getAuthoringMaterials({ page: 1 }, "access-token", {
        list: vi.fn().mockRejectedValue(
          new BackendConnectionError("invalid-response", "bad json"),
        ),
      }),
    ).resolves.toEqual({ kind: "malformed_response" });
  });
});
