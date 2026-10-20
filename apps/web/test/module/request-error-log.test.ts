import { expect, it, vi } from "vitest";

import { logRequestError } from "@/shared/lib/request-error-log.server";

const renderContext = {
  renderSource: "react-server-components",
  routePath: "/(public)/(catalog)/products/[slug]",
  routeType: "render",
} as const;

it("пишет серверный сбой одной строкой с кодом обращения и маршрутом, без параметров адреса", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const failure = Object.assign(new Error("Каталог не ответил"), {
    digest: "3418893140",
  });

  // Next.js передаёт запрос вместе с заголовками; в журнал из них не должно попасть ничего.
  const request = {
    headers: { cookie: "session=secret" },
    method: "GET",
    path: "/products/ai?from=%2Faccount",
  };
  logRequestError(failure, request, renderContext);

  expect(error).toHaveBeenCalledTimes(1);
  const line = String(error.mock.calls[0]?.[0]);
  expect(JSON.parse(line)).toEqual(
    expect.objectContaining({
      digest: "3418893140",
      event: "request-error",
      level: "error",
      message: "Каталог не ответил",
      method: "GET",
      name: "Error",
      path: "/products/[slug]",
      renderSource: "react-server-components",
      routePath: "/(public)/(catalog)/products/[slug]",
      routeType: "render",
    }),
  );
  expect(line).not.toContain("secret");
  expect(line).not.toContain("from=");
});

it("keeps the error digest and template while removing credentials and identifying text", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
  logRequestError(
    Object.assign(
      new Error(
        "Failed for alice@example.test token=private-token cookie=session-private https://example.test/reset?code=private-code",
      ),
      { digest: "42" },
    ),
    { method: "GET", path: "/products/alice@example.test?token=private-token" },
    renderContext,
  );
  const line = String(output.mock.calls[0]?.[0]);
  expect(JSON.parse(line)).toMatchObject({
    digest: "42",
    path: "/products/[slug]",
  });
  for (const secret of [
    "alice@example.test",
    "private-token",
    "session-private",
    "private-code",
  ])
    expect(line).not.toContain(secret);
});

it("пишет и значение, которое не является ошибкой", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  logRequestError(
    "отказ",
    { method: "POST", path: "/api/web-vitals" },
    {
      routePath: "/api/web-vitals",
      routeType: "route",
    },
  );

  expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toEqual(
    expect.objectContaining({
      event: "request-error",
      message: "отказ",
      path: "/api/web-vitals",
    }),
  );
});

it.each([
  "SyntaxError",
  "ZodError",
  "PrismaClientValidationError",
  "DriverAdapterError",
])("omits echoed input for %s", (name) => {
  const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
  logRequestError(
    Object.assign(new Error('Invalid {"customer":"Иван Петров"}'), {
      name,
      digest: "42",
    }),
    { method: "POST", path: "/account" },
    { routePath: "/account", routeType: "route" },
  );
  expect(String(output.mock.calls[0]?.[0])).not.toContain("Иван Петров");
});

it("omits complete URLs and connection strings including path secrets", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
  logRequestError(
    new Error(
      "Failed https://files.test/reports/Иван-Петров https://host/reset/opaque-token postgres://user:secret@host/private-database",
    ),
    { method: "GET", path: "/account" },
    { routePath: "/account", routeType: "route" },
  );
  const saved = String(output.mock.calls[0]?.[0]);
  for (const value of [
    "Иван-Петров",
    "opaque-token",
    "private-database",
    "user:secret",
  ])
    expect(saved).not.toContain(value);
});
