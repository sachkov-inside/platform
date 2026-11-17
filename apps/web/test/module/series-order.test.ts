import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureWebRuntime } from "../support/web-runtime";
import { interceptBackendHttp } from "../support/backend-http";
const backend = vi.fn<(request: Request) => Promise<Response>>();
beforeEach(() => {
  backend.mockReset();
  configureWebRuntime();
  interceptBackendHttp(backend);
});
import { getProductOrder } from "@/features/product-order.server";
import {
  executeReorderProduct,
  reorderProductInvalidInput,
} from "@/features/product-order/api/reorder-product.server";
import { reorderProductOperation } from "@/features/product-order/api/product-order.operation";

const productId = "96000000-0000-4000-8000-000000000001";
const firstId = "96000000-0000-4000-8000-000000000002";
const secondId = "96000000-0000-4000-8000-000000000003";
const chapterId = "96000000-0000-4000-8000-000000000004";
const orderVersion = "a".repeat(64);

describe("Product order web adapters", () => {
  it("maps the backend Product contract to the Russian playlist presentation", async () => {
    reply({
      archived: false,
      chapters: [
        {
          id: chapterId,
          name: "Проект и CI",
          ordinal: 1,
          summary: "Первый абзац.\n\nВторой абзац.",
        },
      ],
      items: [
        {
          chapterId,
          materialId: firstId,
          ordinal: 1,
          publicationState: "published",
          title: "Первый",
        },
        {
          materialId: secondId,
          ordinal: 2,
          publicationState: "draft",
          title: null,
        },
      ],
      name: "Создание Platform Inside",
      orderVersion,
      productId,
      topics: [
        {
          id: chapterId,
          materialIds: [secondId],
          name: "Ревью",
          summary: "",
        },
      ],
    });

    await expect(getProductOrder(productId, "access-token")).resolves.toEqual({
      kind: "ready",
      order: {
        archived: false,
        chapters: [
          {
            id: chapterId,
            name: "Проект и CI",
            summary: "Первый абзац.\n\nВторой абзац.",
          },
        ],
        items: [
          {
            chapterId,
            materialId: firstId,
            publicationState: "published",
            title: "Первый",
          },
          {
            chapterId: null,
            materialId: secondId,
            publicationState: "draft",
            title: "Без названия",
          },
        ],
        name: "Создание Platform Inside",
        orderVersion,
        productId,
        topics: [
          {
            id: chapterId,
            materialIds: [secondId],
            name: "Ревью",
            summary: "",
          },
        ],
      },
    });
    expect(backend).toHaveBeenCalledOnce();
    const request = backend.mock.calls[0]?.[0];
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe(
      `https://platform-api.example.test/authoring/products/${productId}/order`,
    );
    expect(request?.headers.get("authorization")).toBe("Bearer access-token");
  });

  it("passes the complete chapter list and placement and rejects a malformed chapter", async () => {
    const form = validInput();
    const chapters = [{ id: chapterId, name: "  Проект и CI  ", summary: "" }];
    form["chapters"] = chapters;
    form["chapterAssignments"] = { [firstId]: chapterId };
    reply({ orderVersion, productId });
    await expect(reorder(form, "token")).resolves.toMatchObject({
      kind: "saved",
    });
    expect(await savedOrderBody("token")).toEqual(
      expect.objectContaining({
        chapterAssignments: { [firstId]: chapterId },
        chapters: [{ id: chapterId, name: "Проект и CI", summary: "" }],
      }),
    );
    backend.mockClear();
    form["chapters"] = [{ id: chapterId, name: " ", summary: "" }];
    await expect(reorder(form, "token")).resolves.toEqual({
      kind: "error",
      reference: "product-order-form",
    });
    expect(backend).not.toHaveBeenCalled();
  });

  it("passes explicit step assignments and rejects malformed maps while keeping legacy omission", async () => {
    const form = validInput();
    form["stepGroups"] = { [firstId]: "  Release  " };
    reply({ orderVersion, productId });
    await expect(reorder(form, "token")).resolves.toMatchObject({
      kind: "saved",
    });
    expect(await savedOrderBody("token")).toEqual({
      expectedOrderVersion: orderVersion,
      orderedMaterialIds: [secondId, firstId],
      stepGroups: { [firstId]: "Release" },
    });
    form["stepGroups"] = {};
    await reorder(form, "token");
    expect(await savedOrderBody("token")).toEqual(
      expect.objectContaining({ stepGroups: {} }),
    );
    backend.mockClear();
    form["stepGroups"] = { [firstId]: " " };
    await expect(reorder(form, "token")).resolves.toEqual({
      kind: "error",
      reference: "product-order-form",
    });
    expect(backend).not.toHaveBeenCalled();
  });

  it("submits one complete order and maps optimistic conflicts", async () => {
    const input = validInput();
    reply({ orderVersion: "b".repeat(64), productId });
    await expect(reorder(input, "access-token")).resolves.toEqual({
      kind: "saved",
      orderVersion: "b".repeat(64),
    });
    expect(await savedOrderBody("access-token")).toEqual({
      expectedOrderVersion: orderVersion,
      orderedMaterialIds: [secondId, firstId],
    });

    reply({ code: "stale_product_order" }, 409);
    await expect(reorder(input, "access-token")).resolves.toEqual({
      kind: "conflict",
    });
  });

  it("names the Materials refused for their source ownership and keeps other refusals apart", async () => {
    // Порядок в форме: [secondId, firstId]; отказ называет позицию 1.
    reply(
      {
        code: "invalid_reference",
        issues: [
          { code: "material_source_mismatch", path: "/orderedMaterialIds/1" },
        ],
      },
      422,
    );
    await expect(reorder(validInput(), "access-token")).resolves.toEqual({
      kind: "source_mismatch",
      materialIds: [firstId],
    });

    reply(
      {
        code: "invalid_reference",
        issues: [{ code: "material_not_found", path: "/orderedMaterialIds/1" }],
      },
      422,
    );
    await expect(reorder(validInput(), "access-token")).resolves.toEqual({
      kind: "error",
      reference: "product-order-save",
    });
  });

  it("keeps a refusal under a live session apart from a finished session", async () => {
    reply({}, 401);
    await expect(reorder(validInput(), "access-token")).resolves.toEqual({
      kind: "unauthorized",
    });
    reply({}, 403);
    await expect(reorder(validInput(), "access-token")).resolves.toEqual({
      kind: "forbidden",
    });
  });

  it("asks to confirm a removal from a bought product and passes the confirmation", async () => {
    const products = [
      { productId: productId, holders: 3, name: "Купленный продукт" },
    ];
    reply({ code: "product_removal_confirmation_required", products }, 409);
    await expect(reorder(validInput(), "access-token")).resolves.toEqual({
      products: [
        {
          productId: "96000000-0000-4000-8000-000000000001",
          holders: 3,
          name: "Купленный продукт",
        },
      ],
      kind: "removal_confirmation_required",
    });

    reply({ orderVersion: "c".repeat(64), productId });
    const confirmed = validInput();
    confirmed["confirmedProductRemovals"] = [productId];
    await expect(reorder(confirmed, "access-token")).resolves.toMatchObject({
      kind: "saved",
    });
    expect(await savedOrderBody("access-token")).toEqual(
      expect.objectContaining({ confirmedProductRemovals: [productId] }),
    );
    confirmed["confirmedProductRemovals"] = ["not-a-uuid"];
    await expect(reorder(confirmed, "access-token")).resolves.toEqual({
      kind: "error",
      reference: "product-order-form",
    });
  });
});

function validInput(): Record<string, unknown> {
  return {
    expectedOrderVersion: orderVersion,
    orderedMaterialIds: [secondId, firstId],
    productId,
  };
}

/** Parses the JSON body as the Route Handler does, then saves the composition. */
function reorder(body: Record<string, unknown>, accessToken: string) {
  const input = reorderProductOperation.input.safeParse(body);
  return input.success
    ? executeReorderProduct(input.data, accessToken)
    : Promise.resolve(reorderProductInvalidInput());
}

function reply(body: unknown, status = 200): void {
  backend.mockImplementation(() =>
    Promise.resolve(Response.json(body, { status })),
  );
}
async function savedOrderBody(token: string): Promise<unknown> {
  const request = backend.mock.lastCall?.[0];
  if (request === undefined)
    throw new Error("Expected Product order HTTP request");
  expect(request.method).toBe("PUT");
  expect(request.url).toBe(
    `https://platform-api.example.test/authoring/products/${productId}/order`,
  );
  expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
  return request.clone().json();
}
