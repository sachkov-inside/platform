import { expect, it, vi } from "vitest";

import { logRequestError } from "@/shared/lib/request-error-log.server";

const renderContext = {
  renderSource: "react-server-components",
  routePath: "/(public)/(catalog)/guides/[slug]",
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
    path: "/guides/ai?from=%2Faccount",
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
      path: "/guides/ai",
      renderSource: "react-server-components",
      routePath: "/(public)/(catalog)/guides/[slug]",
      routeType: "render",
    }),
  );
  expect(line).not.toContain("secret");
  expect(line).not.toContain("from=");
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
