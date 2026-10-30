import { vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ body: undefined }));
vi.mock("vitest", async (original) => ({
  ...(await original()),
  test: (_name, body) => {
    lifecycle.body = body;
  },
}));

const { beforeAll, expect, test } = await vi.importActual("vitest");
beforeAll(async () => {
  await import("./register.mjs");
});
test("captures the external Vitest registration", () => {
  expect(lifecycle.body).toBeTypeOf("function");
  expect(lifecycle.body()).toBe("registered");
});
