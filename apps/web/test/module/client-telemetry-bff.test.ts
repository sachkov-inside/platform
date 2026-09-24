import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/shared/auth/index.server", async () => {
  const origin = await import("@/shared/auth/same-origin-mutation.server");
  return {
    isSameOriginMutation: origin.isSameOriginMutation,
    readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
  };
});
import {
  handleRenderErrorReport,
  handleWebVitalsReport,
} from "@/features/client-telemetry.server";

const lcp = { id: "v5-1", name: "LCP", navigationType: "navigate", rating: "good", value: 1_234.5 };

function report(
  path: string,
  body: string,
  { origin = "https://inside.example.test" }: { readonly origin?: string } = {},
) {
  return new Request(`https://inside.example.test${path}`, {
    body,
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
}

function loggedLines(spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }): unknown[] {
  return spy.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown);
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

it("пишет каждую метрику загрузки отдельной строкой журнала с адресом страницы", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const cls = { id: "v5-2", name: "CLS", value: 0.02 };

  const response = await handleWebVitalsReport(
    report("/api/web-vitals", JSON.stringify({ metrics: [lcp, cls], route: "/guides/ai" })),
  );

  expect(response.status).toBe(204);
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(loggedLines(info)).toEqual([
    expect.objectContaining({ event: "web-vital", level: "info", route: "/guides/ai", ...lcp }),
    expect.objectContaining({ event: "web-vital", level: "info", route: "/guides/ai", ...cls }),
  ]);
});

it("пишет ошибку отрисовки с кодом обращения в журнал ошибок", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const renderError = {
    boundary: "public",
    digest: "2195732781",
    message: "Не удалось прочитать ответ",
    name: "Error",
    route: "/account",
  };

  const response = await handleRenderErrorReport(
    report("/api/render-errors", JSON.stringify(renderError)),
  );

  expect(response.status).toBe(204);
  expect(loggedLines(error)).toEqual([
    expect.objectContaining({ event: "client-render-error", level: "error", ...renderError }),
  ]);
});

it("не принимает отчёт с чужого сайта и ничего не пишет", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

  const response = await handleWebVitalsReport(
    report("/api/web-vitals", JSON.stringify({ metrics: [lcp], route: "/" }), {
      origin: "https://elsewhere.example.test",
    }),
  );

  expect(response.status).toBe(403);
  expect(info).not.toHaveBeenCalled();
});

it("отклоняет отчёт с адресом, в котором есть параметры запроса", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

  const response = await handleWebVitalsReport(
    report("/api/web-vitals", JSON.stringify({ metrics: [lcp], route: "/subscription/return?payment=1" })),
  );

  expect(response.status).toBe(400);
  expect(info).not.toHaveBeenCalled();
});

it("отклоняет неизвестную метрику и тело, которое не JSON", async () => {
  const unknownMetric = await handleWebVitalsReport(
    report("/api/web-vitals", JSON.stringify({ metrics: [{ ...lcp, name: "Custom" }], route: "/" })),
  );
  const notJson = await handleWebVitalsReport(report("/api/web-vitals", "metrics=LCP"));

  expect(unknownMetric.status).toBe(400);
  expect(notJson.status).toBe(400);
});

it("отклоняет слишком большой отчёт, даже если его длина не заявлена", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const oversized = JSON.stringify({
    boundary: "public",
    message: "x".repeat(20 * 1_024),
    name: "Error",
    route: "/",
  });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(oversized));
      controller.close();
    },
  });
  const request = new Request("https://inside.example.test/api/render-errors", {
    body: stream,
    duplex: "half",
    headers: { origin: "https://inside.example.test" },
    method: "POST",
  } as RequestInit);

  const response = await handleRenderErrorReport(request);

  expect(response.status).toBe(413);
  expect(error).not.toHaveBeenCalled();
});
