import { z } from "zod";
import { expect, test } from "@playwright/test";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT required");
const backend = `http://127.0.0.1:${backendPort}`;
const taskPath = "/products/ai-engineering/tasks/aie-ch1-onboarding";

test("production reaches attempt 51 and its feedback; a failed continuation retries the same private page", async ({
  page,
  context,
  request,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("Web origin required");
  const { wrapSession } = await import("@logto/node");
  const session = await wrapSession(
    {
      accessToken: JSON.stringify({
        [`@${backend}`]: {
          // deterministic-test-allow wall-clock: the separate production Web process and Logto validate this cookie against their live clock.
          expiresAt: Math.floor(Date.now() / 1_000) + 3600,
          scope: "",
          token: "navigation-member-token",
        },
      }),
      idToken: "navigation.id.token",
      refreshToken: "navigation-refresh-token",
    },
    "inside-navigation-logto-cookie-secret-key",
  );
  await context.addCookies([
    {
      name: "logto_inside-web-navigation",
      value: session,
      httpOnly: true,
      sameSite: "Lax",
      url: baseURL,
    },
  ]);
  await request.post(`${backend}/__own-history`, {
    data: { unavailable: false },
  });
  try {
    await page.goto(taskPath, { waitUntil: "commit" });
    await expect(
      page.locator("[data-own-submissions] [data-submission]"),
    ).toHaveCount(50);
    await request.post(`${backend}/__own-history`, {
      data: { unavailable: true, hold: true },
    });
    await page.getByRole("link", { name: "Предыдущие сдачи" }).click();
    await expect
      .poll(
        async () =>
          z
            .object({ held: z.boolean() })
            .parse(await (await request.get(`${backend}/__own-history`)).json())
            .held,
      )
      .toBe(true);
    await request.post(`${backend}/__own-history`, {
      data: { unavailable: true, hold: false },
    });
    await expect(page.getByText("Сдачи сейчас не загрузились.")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("attemptsAfter")).toBe(
      "older-history",
    );
    await request.post(`${backend}/__own-history`, {
      data: { unavailable: false },
    });
    await page.getByRole("button", { name: "Повторить" }).click();
    await expect(
      page.locator("[data-own-submissions] [data-submission]"),
    ).toHaveCount(1);
    await expect(
      page.getByText("Oldest feedback remains reachable"),
    ).toBeVisible();
    await expect(
      page.getByText("Сдано 2 октября", { exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("attemptsAfter")).toBe(
      "older-history",
    );
    await info.attach("complete-own-history", {
      body: JSON.stringify({
        initialAttempts: 50,
        olderAttempts: 1,
        oldestFeedbackVisible: true,
        continuationHeldBefore503: true,
        continuationPreservedAcrossRetry: true,
      }),
      contentType: "application/json",
    });
    await page.getByRole("link", { name: "К новым сдачам" }).click();
    await expect(
      page.locator("[data-own-submissions] [data-submission]"),
    ).toHaveCount(50);
  } finally {
    await request.post(`${backend}/__own-history`, {
      data: { unavailable: false, hold: false },
    });
  }
});
