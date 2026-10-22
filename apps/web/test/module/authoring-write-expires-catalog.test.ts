import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

const fakes = vi.hoisted(() => ({ expirePublicCatalog: vi.fn() }));

// Сам сброс — вызов `revalidateTag`; проверяется правило, какие записи до него доходят.
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidateTag: fakes.expirePublicCatalog,
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));
vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: () => Promise.resolve("token"),
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/auth/optional-platform-access-token.server", () => ({
  getOptionalPlatformAccessToken: () => Promise.resolve(undefined),
}));

function mutation(path: string, method = "POST"): Request {
  return new Request(`https://inside.example.test${path}`, {
    body: JSON.stringify({ value: "1" }),
    headers: {
      "content-type": "application/json",
      origin: "https://inside.example.test",
    },
    method,
  });
}

/** Any operation: the catalog rule reads the request's own path, not the operation's. */
const writeOperation = defineMutationOperation({
  input: z.object({ value: z.string() }),
  method: "POST",
  path: "/api/authoring/write",
  result: z.unknown(),
  transportFailure: () => null,
});

async function serve(
  request: Request,
  execute: () => Promise<unknown>,
): Promise<Response> {
  const { handleMutationOperation } =
    await import("@/shared/auth/authenticated-mutation-handler.server");
  return handleMutationOperation(request, writeOperation, {
    execute,
    invalidInput: () => null,
  });
}

describe("an authoring write expires the public catalog cache", () => {
  beforeEach(() => {
    fakes.expirePublicCatalog.mockReset();
  });

  it("expires the catalog after a catalog authoring write", async () => {
    const response = await serve(
      mutation("/api/authoring/products/order", "PUT"),
      () => Promise.resolve({ ok: true }),
    );

    expect(response.status).toBe(200);
    expect(fakes.expirePublicCatalog).toHaveBeenCalledTimes(1);
  });

  // Next.js выполняет отложенный сброс только при обычном возврате обработчика: исключение его
  // отбросило бы, поэтому сбой записи каталога обязан вернуться ответом.
  it("answers a failed catalog write with a response, so that the queued expiry still runs", async () => {
    // Исключение больше не доходит до Next.js, поэтому обработчик печатает его сам.
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const failure = new Error("response lost");

    const response = await serve(
      mutation("/api/authoring/products/order", "PUT"),
      () => Promise.reject(failure),
    );

    expect(response.status).toBe(503);
    expect(fakes.expirePublicCatalog).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(failure);
  });

  it("lets a failed write outside the catalog fail as before", async () => {
    await expect(
      serve(mutation("/api/reading-progress/state"), () =>
        Promise.reject(new Error("response lost")),
      ),
    ).rejects.toThrow("response lost");

    expect(fakes.expirePublicCatalog).not.toHaveBeenCalled();
  });

  // Описание продукта подставляет сроки его предложения из общего кеша (#780).
  it.each([
    ["an offer write", "/api/authoring/billing/offers/save"],
    ["a promotion write", "/api/authoring/billing/promotions/save"],
    [
      "a payment option write",
      "/api/authoring/billing/payment-options/archive",
    ],
  ])("expires the catalog after %s", async (_name, path) => {
    await serve(mutation(path), () => Promise.resolve({ ok: true }));

    expect(fakes.expirePublicCatalog).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a reader's own write", "/api/reading-progress/state"],
    [
      "a billing command outside offers: prices never enter the shared cache",
      "/api/authoring/billing/cohorts/save",
    ],
  ])("keeps the catalog after %s", async (_name, path) => {
    await serve(mutation(path), () => Promise.resolve({ ok: true }));

    expect(fakes.expirePublicCatalog).not.toHaveBeenCalled();
  });

  it("keeps the catalog when the request never reached the write", async () => {
    const crossOrigin = new Request(
      "https://inside.example.test/api/authoring/products/order",
      {
        body: "{}",
        headers: {
          "content-type": "application/json",
          origin: "https://elsewhere.example.test",
        },
        method: "PUT",
      },
    );

    const response = await serve(crossOrigin, () =>
      Promise.resolve({ ok: true }),
    );

    expect(response.status).toBe(403);
    expect(fakes.expirePublicCatalog).not.toHaveBeenCalled();
  });
});
