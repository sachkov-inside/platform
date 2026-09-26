import { beforeEach, describe, expect, it, vi } from "vitest";

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
  const body = new FormData();
  body.set("value", "1");
  return new Request(`https://inside.example.test${path}`, {
    body,
    headers: { origin: "https://inside.example.test" },
    method,
  });
}

describe("an authoring write expires the public catalog cache", () => {
  beforeEach(() => {
    fakes.expirePublicCatalog.mockReset();
  });

  it("expires the catalog after a catalog authoring write", async () => {
    const { handleAuthenticatedMutation } =
      await import("@/shared/auth/authenticated-mutation-handler.server");

    const response = await handleAuthenticatedMutation(
      mutation("/api/authoring/guides/order", "PUT"),
      () => Promise.resolve({ ok: true }),
    );

    expect(response.status).toBe(200);
    expect(fakes.expirePublicCatalog).toHaveBeenCalledTimes(1);
  });

  // Next.js выполняет отложенный сброс только при обычном возврате обработчика: исключение его
  // отбросило бы, поэтому сбой записи каталога обязан вернуться ответом.
  it("answers a failed catalog write with a response, so that the queued expiry still runs", async () => {
    const { handleAuthenticatedMutation } =
      await import("@/shared/auth/authenticated-mutation-handler.server");

    // Исключение больше не доходит до Next.js, поэтому обработчик печатает его сам.
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const failure = new Error("response lost");

    const response = await handleAuthenticatedMutation(
      mutation("/api/authoring/guides/order", "PUT"),
      () => Promise.reject(failure),
    );

    expect(response.status).toBe(503);
    expect(fakes.expirePublicCatalog).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(failure);
  });

  it("lets a failed write outside the catalog fail as before", async () => {
    const { handleAuthenticatedMutation } =
      await import("@/shared/auth/authenticated-mutation-handler.server");

    await expect(
      handleAuthenticatedMutation(mutation("/api/reading-progress/state"), () =>
        Promise.reject(new Error("response lost")),
      ),
    ).rejects.toThrow("response lost");

    expect(fakes.expirePublicCatalog).not.toHaveBeenCalled();
  });

  it.each([
    ["a reader's own write", "/api/reading-progress/state"],
    [
      "a billing command: prices never enter the shared cache",
      "/api/authoring/billing/offers/save",
    ],
  ])("keeps the catalog after %s", async (_name, path) => {
    const { handleAuthenticatedMutation } =
      await import("@/shared/auth/authenticated-mutation-handler.server");

    await handleAuthenticatedMutation(mutation(path), () =>
      Promise.resolve({ ok: true }),
    );

    expect(fakes.expirePublicCatalog).not.toHaveBeenCalled();
  });

  it("keeps the catalog when the request never reached the write", async () => {
    const { handleAuthenticatedMutation } =
      await import("@/shared/auth/authenticated-mutation-handler.server");
    const crossOrigin = new Request(
      "https://inside.example.test/api/authoring/guides/order",
      {
        body: new FormData(),
        headers: { origin: "https://elsewhere.example.test" },
        method: "PUT",
      },
    );

    const response = await handleAuthenticatedMutation(crossOrigin, () =>
      Promise.resolve({ ok: true }),
    );

    expect(response.status).toBe(403);
    expect(fakes.expirePublicCatalog).not.toHaveBeenCalled();
  });
});
