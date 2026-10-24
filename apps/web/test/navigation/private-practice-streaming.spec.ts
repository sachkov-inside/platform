import { expect, test } from "@playwright/test";
import { z } from "zod";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT required");
const backend = `http://127.0.0.1:${backendPort}`;

for (const unavailable of [false, true]) {
  test(`private body and navigation stream before held Task workspace resolves ${unavailable ? "unavailable" : "unbound"}`, async ({
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
        page.getByText(
          "Практика сейчас не загрузилась. Обнови страницу, чтобы повторить.",
        ),
      ).toHaveCount(0);
      await info.attach("private-body-before-task", {
        body: JSON.stringify({
          taskHeld: true,
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
          page.getByText(
            "Практика сейчас не загрузилась. Обнови страницу, чтобы повторить.",
          ),
        ).toBeVisible();
      await expect(page.locator("[data-reader-body]")).toBeVisible();
    } finally {
      await request.post(`${backend}/__practice-hold`, {
        data: { hold: false },
      });
    }
  });
}

for (const ordinal of [1, 3]) {
  test(`coexisting historical Practice and current bound Task use one mechanism in Material ${String(ordinal)}`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("Web origin required");
    const { wrapSession } = await import("@logto/node");
    const session = await wrapSession(
      {
        accessToken: JSON.stringify({
          [`@${backend}`]: {
            // deterministic-test-allow wall-clock: real production Web validates this synthetic session with its live clock.
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
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
    await request.post(`${backend}/__coexisting-practice-task?enabled=true`);
    await request.delete(`${backend}/__requests`);
    try {
      await page.goto(`/materials/navigation-lesson-${String(ordinal)}`, {
        waitUntil: "commit",
      });
      const task = page.getByRole("region", {
        name: "Сдача задания",
        exact: true,
      });
      await expect(task).toHaveCount(1);
      await expect(task).toContainText(
        ordinal === 1 ? "navigation-free-task" : "navigation-closed-task",
      );
      await expect(
        page.getByRole("region", { name: "Проверка практики", exact: true }),
      ).toHaveCount(0);
      const { requests: reads } = z
        .object({
          requests: z.array(
            z.object({ path: z.string(), authorized: z.boolean() }),
          ),
        })
        .parse(await (await request.get(`${backend}/__requests`)).json());
      expect(reads.filter((row) => row.path.endsWith("/practices"))).toEqual(
        [],
      );
      expect(reads.filter((row) => row.path.endsWith("/task"))).toHaveLength(1);
      const setup = await page.request.get("/practice-review-setup.txt");
      expect(await setup.text()).toContain("learning_task_read");
      expect(await setup.text()).not.toContain("learning_practice_read");
      await expect(
        page.getByText("historical:coexisting-practice"),
      ).toHaveCount(0);
      await context.clearCookies();
      const materialId = `33333333-3333-4333-8333-33333333330${String(ordinal)}`;
      const anonymousTask = await request.get(
        `${backend}/library/materials/${materialId}/task`,
      );
      expect(anonymousTask.status()).toBe(200);
      expect(await anonymousTask.json()).toMatchObject({
        access: ordinal === 1 ? "open" : "closed",
      });
      if (ordinal === 3)
        expect(await anonymousTask.text()).not.toContain(
          "ЗАКРЫТОЕ-ТЕЛО-ЗАДАНИЯ",
        );
      await page.goto(`/materials/navigation-lesson-${String(ordinal)}`, {
        waitUntil: "commit",
      });
      if (ordinal === 3) {
        await expect(page.locator("[data-reader-body]")).toHaveCount(0);
        await expect(
          page.getByText("ЗАКРЫТОЕ-ТЕЛО-УРОКА", { exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("region", { name: "Сдача задания", exact: true }),
        ).toHaveCount(0);
      } else {
        await expect(page.locator("[data-reader-body]")).toBeVisible();
        await expect(
          page.getByRole("region", { name: "Сдача задания", exact: true }),
        ).toHaveCount(1);
      }
    } finally {
      await request.post(`${backend}/__coexisting-practice-task?enabled=false`);
    }
  });
}
