import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/shared/auth/index.server", async () => {
  const origin = await import("@/shared/auth/same-origin-mutation.server");
  return {
    isSameOriginMutation: origin.isSameOriginMutation,
    readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
  };
});
import { createEntryRateLimiter, limitEntryRequest } from "@/_app/entry-rate-limit";

/** Страница в браузере: вкладку можно скрыть и показать, beacon запоминает отправленное. */
function stubPage() {
  const page = new EventTarget();
  const tab = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const beacons: { readonly route: string; readonly body: Blob }[] = [];
  vi.stubGlobal("window", Object.assign(page, { location: { pathname: "/guides/ai" } }));
  vi.stubGlobal("document", tab);
  vi.stubGlobal("navigator", {
    sendBeacon: (route: string, body: Blob) => beacons.push({ body, route }) > 0,
  });
  return {
    beacons,
    hide() {
      tab.visibilityState = "hidden";
      tab.dispatchEvent(new Event("visibilitychange"));
    },
    leave() {
      page.dispatchEvent(new Event("pagehide"));
    },
    show() {
      tab.visibilityState = "visible";
      tab.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

/** Отчёт идёт тем же путём, что в production: сначала предел на клиента в proxy, затем обработчик. */
async function deliver(
  limiter: ReturnType<typeof createEntryRateLimiter>,
  handle: (request: Request) => Promise<Response>,
  route: string,
  body: string,
  address: string,
): Promise<number> {
  const request = new Request(`https://inside.example.test${route}`, {
    body,
    headers: { origin: "https://inside.example.test", "x-forwarded-for": address },
    method: "POST",
  });
  const limited = limitEntryRequest(limiter, request, "production");
  return limited === undefined ? (await handle(request)).status : limited.status;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

it("обычная страница шлёт один отчёт на скрытие вкладки и не попадает ни под один предел", async () => {
  const page = stubPage();
  const { queueWebVital } = await import("@/features/client-telemetry");

  for (const name of ["TTFB", "FCP", "LCP", "CLS"]) queueWebVital({ id: `v5-${name}`, name, value: 1 });
  page.hide();
  page.show();
  page.hide();
  queueWebVital({ id: "v5-INP", name: "INP", value: 1 });
  page.leave();

  expect(page.beacons.map((beacon) => beacon.route)).toEqual(["/api/web-vitals", "/api/web-vitals"]);

  const { handleWebVitalsReport } = await import("@/features/client-telemetry.server");
  const limiter = createEntryRateLimiter();
  const answers = [];
  for (const beacon of page.beacons) {
    answers.push(await deliver(limiter, handleWebVitalsReport, beacon.route, await beacon.body.text(), "203.0.113.7"));
  }

  expect(answers).toEqual([204, 204]);
});

it("загруженная минута обычных посещений со всей площадки проходит потолок журнала", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { handleRenderErrorReport, handleWebVitalsReport } = await import("@/features/client-telemetry.server");
  const limiter = createEntryRateLimiter();
  const loadMetrics = ["TTFB", "FCP", "LCP", "CLS", "INP"].map((name) => ({ id: `v5-${name}`, name, value: 1 }));
  const vitals = JSON.stringify({ metrics: loadMetrics, route: "/guides/ai" });
  const renderError = JSON.stringify({ boundary: "public", message: "Сбой", name: "Error", route: "/" });

  // 60 посетителей за минуту: у каждого одна страница с полным набором метрик и одна пойманная ошибка.
  const answers = [];
  for (let visitor = 1; visitor <= 60; visitor += 1) {
    const address = `198.51.100.${String(visitor)}`;
    answers.push(await deliver(limiter, handleWebVitalsReport, "/api/web-vitals", vitals, address));
    answers.push(await deliver(limiter, handleRenderErrorReport, "/api/render-errors", renderError, address));
  }

  expect(answers).toEqual(Array.from({ length: 120 }, () => 204));
});
