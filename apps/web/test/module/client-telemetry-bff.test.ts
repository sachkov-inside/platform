import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/auth/index.server", async () => {
  const origin = await import("@/shared/auth/same-origin-mutation.server");
  return {
    isSameOriginMutation: origin.isSameOriginMutation,
    readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
  };
});

let handleRenderErrorReport: (request: Request) => Promise<Response>;
let handleWebVitalsReport: (request: Request) => Promise<Response>;

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

function loggedEvents(
  spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } },
  event: string,
): unknown[] {
  return loggedLines(spy).filter((line) => (line as { readonly event?: unknown }).event === event);
}

beforeEach(async () => {
  // Потолок журнала живёт на уровне процесса: каждый тест начинает со свежего модуля и пустого окна.
  vi.resetModules();
  ({ handleRenderErrorReport, handleWebVitalsReport } = await import("@/features/client-telemetry.server"));
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

describe("общий потолок журнала для отчётов браузера", () => {
  const renderError = { boundary: "public", message: "Сбой", name: "Error", route: "/" };

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.useFakeTimers({ now: Date.parse("2026-09-25T09:00:00Z"), toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("сверх потолка отвечает 429 с Retry-After и не пишет отчёт в журнал", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const send = () => handleRenderErrorReport(report("/api/render-errors", JSON.stringify(renderError)));

    const accepted = [];
    for (let index = 0; index < 60; index += 1) accepted.push((await send()).status);
    vi.advanceTimersByTime(15_000);
    const refused = await send();

    expect(accepted).toEqual(Array.from({ length: 60 }, () => 204));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("45");
    expect(refused.headers.get("cache-control")).toBe("no-store, private");
    expect(loggedEvents(error, "client-render-error")).toHaveLength(60);
  });

  it("отмечает в журнале только первый отказ окна, а в новом окне снова принимает отчёты", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const send = () => handleRenderErrorReport(report("/api/render-errors", JSON.stringify(renderError)));

    for (let index = 0; index < 63; index += 1) await send();
    const notices = loggedEvents(error, "client-report-limit-reached");
    vi.advanceTimersByTime(60_000);
    const nextWindow = await send();

    expect(notices).toEqual([
      expect.objectContaining({ level: "error", recordsPerWindow: 60, report: "render-errors", windowSeconds: 60 }),
    ]);
    expect(nextWindow.status).toBe(204);
  });

  it("считает метрики строками журнала и не пишет часть отчёта, который не помещается", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const metrics = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ ...lcp, id: `v5-${String(index)}` }));
    const send = (count: number) =>
      handleWebVitalsReport(report("/api/web-vitals", JSON.stringify({ metrics: metrics(count), route: "/" })));

    const statuses = [];
    for (let index = 0; index < 14; index += 1) statuses.push((await send(20)).status);
    statuses.push((await send(1)).status);
    const overflowing = await send(20);
    const fitting = await send(19);

    expect(statuses).toEqual(Array.from({ length: 15 }, () => 204));
    expect(overflowing.status).toBe(429);
    expect(fitting.status).toBe(204);
    expect(loggedEvents(info, "web-vital")).toHaveLength(300);
  });

  it("поток метрик не вытесняет отчёты об ошибках", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const vitals = JSON.stringify({ metrics: [lcp], route: "/" });

    let lastVitals = 0;
    for (let index = 0; index < 301; index += 1) {
      lastVitals = (await handleWebVitalsReport(report("/api/web-vitals", vitals))).status;
    }
    const errorReport = await handleRenderErrorReport(report("/api/render-errors", JSON.stringify(renderError)));

    expect(lastVitals).toBe(429);
    expect(errorReport.status).toBe(204);
  });

  it("на стенде и в проверках разработки потолок не действует", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const send = () => handleRenderErrorReport(report("/api/render-errors", JSON.stringify(renderError)));

    let last = 0;
    for (let index = 0; index < 61; index += 1) last = (await send()).status;

    expect(last).toBe(204);
  });
});
