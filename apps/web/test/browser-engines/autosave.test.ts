import { expect as ui } from "@playwright/test";
import { afterAll, test } from "vitest";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

const fixture = createOwnedBrowserFixture("autosave");
afterAll(() => fixture.close(), 30_000);

async function editor() {
  const { browsers, url } = await fixture.start();
  const chromium = browsers.get("chromium");
  if (!chromium) throw new Error("Missing Chromium");
  const page = await chromium.newPage();
  await page.goto(url);
  return page;
}

test("a suspended render cannot replace the committed writer, value or permission during navigation", async () => {
  const page = await editor();
  const blocked = Promise.withResolvers<undefined>();
  try {
    await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
    await page.route("**/pending-editor", async (route) => {
      await blocked.promise;
      await route.fulfill({ body: "" });
    });
    const writes: string[] = [];
    await page.route("**/save/*", async (route) => {
      const request = route.request();
      writes.push(
        new URL(request.url()).pathname + " " + (request.postData() ?? ""),
      );
      await route.fulfill({ status: 204 });
    });
    await page.getByLabel("Draft").fill("committed");
    await page.getByText("Change writer").click();
    const renderStarted = page.waitForRequest("**/pending-editor");
    await page.getByText("Suspend writer").click();
    await renderStarted;
    await ui(page.locator("output")).toHaveText("dirty");
    await page.getByText("Leave").click();
    await ui(page.getByRole("heading")).toHaveText("Destination");
    ui(writes).toEqual(["/save/second committed"]);
  } finally {
    blocked.resolve(undefined);
    await page.close();
  }
}, 30_000);

test("a failed save retries its snapshot before a newer edit; an upload keeps the link blocked until released", async () => {
  const page = await editor();
  const release = Promise.withResolvers<undefined>();
  const started = Promise.withResolvers<undefined>();
  try {
    const writes: string[] = [];
    await page.route("**/save/*", async (route) => {
      writes.push(route.request().postData() ?? "");
      if (writes.length === 1) {
        started.resolve(undefined);
        await release.promise;
        await route.fulfill({ status: 503 });
      } else await route.fulfill({ status: 204 });
    });
    await page.getByLabel("Draft").fill("first");
    await started.promise;
    await page.getByLabel("Draft").fill("second");
    await page.getByRole("link").click();
    release.resolve(undefined);
    await ui(page.locator("output")).toHaveText("error");
    const intercepted = await page.evaluateHandle(() => {
      let click: MouseEvent | undefined;
      window.addEventListener(
        "click",
        (event) => {
          click = event;
        },
        { capture: true, once: true },
      );
      return () => click?.defaultPrevented;
    });
    await page.getByRole("link").click();
    ui(await intercepted.evaluate((read) => read())).toBe(true);
    await page.getByText("Toggle upload").click();
    ui(writes).toEqual(["first"]);
    await page.getByText("Retry").click();
    await ui(page.locator("output")).toHaveText("saved");
    ui(writes).toEqual(["first", "first", "second"]);
    const target = page.getByRole("link");
    await target.evaluate((link) => {
      link.addEventListener("click", () => {
        sessionStorage.setItem("target", "reached");
      });
    });
    await target.click();
    ui(await page.evaluate(() => sessionStorage.getItem("target"))).toBeNull();
    await page.getByText("Toggle upload").click();
    await target.click();
    await ui(page.getByRole("heading")).toHaveText("Destination");
    ui(await page.evaluate(() => sessionStorage.getItem("target"))).toBe(
      "reached",
    );
  } finally {
    release.resolve(undefined);
    await page.close();
  }
}, 30_000);

test("hiding before debounce cancels the write; an invalid edit can be undone without saving again", async () => {
  const page = await editor();
  try {
    // Pause the browser clock to cross autosave deadlines without timing input events.
    await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
    const writes: string[] = [];
    await page.route("**/save/*", async (route) => {
      writes.push(route.request().postData() ?? "");
      await route.fulfill({ status: writes.length === 1 ? 422 : 204 });
    });
    const title = page.getByLabel("Draft");
    await title.fill("invalid");
    await page.getByText("Toggle editor").click();
    await ui(title).toBeHidden();
    await page.clock.runFor(1400);
    ui(writes).toEqual([]);
    await page.getByText("Toggle editor").click();
    await ui(title).toBeVisible();
    await ui(title).toHaveValue("invalid");
    await page.clock.runFor(700);
    await ui(page.locator("output")).toHaveText("error");
    await page.clock.runFor(1400);
    ui(writes).toEqual(["invalid"]);
    await title.fill("");
    await ui(page.locator("output")).toHaveText("saved");
    await page.clock.runFor(700);
    ui(writes).toEqual(["invalid"]);
    await title.fill("corrected");
    await page.clock.runFor(700);
    await ui(page.locator("output")).toHaveText("saved");
    ui(writes).toEqual(["invalid", "corrected"]);
  } finally {
    await page.close();
  }
}, 30_000);

test("undoing an edit while its validation is pending leaves the saved baseline after 422", async () => {
  const page = await editor();
  const release = Promise.withResolvers<undefined>();
  try {
    const writes: string[] = [];
    await page.route("**/save/*", async (route) => {
      writes.push(route.request().postData() ?? "");
      await release.promise;
      await route.fulfill({ status: 422 });
    });
    const draft = page.getByLabel("Draft");
    await draft.fill("invalid");
    await ui(page.locator("output")).toHaveText("pending");
    await draft.fill("");
    release.resolve(undefined);
    await ui(page.locator("output")).toHaveText("saved");
    await page.getByRole("link").click();
    await ui(page.getByRole("heading")).toHaveText("Destination");
    ui(writes).toEqual(["invalid"]);
  } finally {
    release.resolve(undefined);
    await page.close();
  }
}, 30_000);

test("an upload started while a link waits for a successful save blocks that navigation", async () => {
  const page = await editor();
  const release = Promise.withResolvers<undefined>();
  try {
    await page.route("**/save/*", async (route) => {
      await release.promise;
      await route.fulfill({ status: 204 });
    });
    await page.getByLabel("Draft").fill("first");
    await page.getByRole("link").click();
    await ui(page.locator("output")).toHaveText("pending");
    await page.getByText("Toggle upload").click();
    release.resolve(undefined);
    await ui(page.locator("output")).toHaveText("saved");
    await page.getByText("Toggle upload").click();
    await page.getByRole("link").click();
    await ui(page.getByRole("heading")).toHaveText("Destination");
  } finally {
    release.resolve(undefined);
    await page.close();
  }
}, 30_000);
