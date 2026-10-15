import { expect, test } from "@playwright/test";
import { z } from "zod";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT required");
const backend = `http://127.0.0.1:${backendPort}`;

for (const unavailable of [false, true]) {
  test(`private body and navigation stream before held Practice resolves ${unavailable ? "unavailable" : "empty"}`, async ({
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
    await request.post(`${backend}/__control`, {
      data: { delayMs: 0, unavailable: false },
    });
    await request.post(`${backend}/__practice-hold`, {
      data: { hold: true, unavailable },
    });
    try {
      await page.goto(
        `/materials/navigation-lesson-3?from=${encodeURIComponent("/products/navigation-proof/programme")}`,
        { waitUntil: "commit" },
      );
      await expect
        .poll(
          async () =>
            z
              .object({ held: z.boolean() })
              .parse(
                await (await request.get(`${backend}/__practice-hold`)).json(),
              ).held,
        )
        .toBe(true);
      await expect(page.locator("[data-reader-body]")).toBeVisible();
      await expect(page.locator("[data-reader-body]")).toContainText(
        "ЗАКРЫТОЕ-ТЕЛО-УРОКА",
      );
      await expect(page.locator("[data-course-reading]:visible")).toBeVisible();
      await expect(
        page.getByText("Задания для проверки сейчас недоступны."),
      ).toHaveCount(0);
      await info.attach("private-body-before-practice", {
        body: JSON.stringify({
          practiceHeld: true,
          allowedBodyVisible: true,
          navigationVisible: true,
          unavailable,
        }),
        contentType: "application/json",
      });
      await request.post(`${backend}/__practice-hold`, {
        data: { hold: false, unavailable },
      });
      if (unavailable)
        await expect(
          page.getByText("Задания для проверки сейчас недоступны."),
        ).toBeVisible();
      await expect(page.locator("[data-reader-body]")).toBeVisible();
    } finally {
      await request.post(`${backend}/__practice-hold`, {
        data: { hold: false },
      });
    }
  });
}
