import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/shared/auth/index.server", async () => {
  const origin = await import("@/shared/auth/same-origin-mutation.server");
  return {
    isSameOriginMutation: origin.isSameOriginMutation,
    readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
  };
});
import { createEntryRateLimiter, limitEntryRequest } from "@/_app/entry-rate-limit";
import { handleWebVitalsReport } from "@/features/client-telemetry.server";

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

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  const limiter = createEntryRateLimiter();
  const answers = [];
  for (const beacon of page.beacons) {
    const request = new Request(`https://inside.example.test${beacon.route}`, {
      body: await beacon.body.text(),
      headers: { origin: "https://inside.example.test", "x-forwarded-for": "203.0.113.7" },
      method: "POST",
    });
    answers.push(limitEntryRequest(limiter, request, "production")?.status ?? (await handleWebVitalsReport(request)).status);
  }

  expect(answers).toEqual([204, 204]);
});
