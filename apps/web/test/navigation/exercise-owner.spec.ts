import { expect, test, type BrowserContext } from "@playwright/test";

const lesson = "/materials/navigation-exercise-owner";
const storeKey =
  "inside.exercise-answers.v1:6d155605-f852-461a-bdeb-df68b0b441c4";
const accountA = "dddddddd-0000-4000-8000-000000000001";
const accountB = "dddddddd-0000-4000-8000-000000000002";

async function signIn(context: BrowserContext, baseURL: string, token: string) {
  const { wrapSession } = await import("@logto/node");
  const port = process.env["FAKE_BACKEND_PORT"];
  if (port === undefined) throw new Error("Missing external backend port");
  const value = await wrapSession(
    {
      accessToken: JSON.stringify({
        [`@http://127.0.0.1:${port}`]: {
          // deterministic-test-allow wall-clock: the real Logto session expires against the server clock.
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          scope: "",
          token,
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
      url: baseURL,
      value,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

for (const identity of ["guest", "account"] as const) {
  test(`a pending exercise answer belongs only to the resolved ${identity}`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("Missing Web origin");
    if (identity === "account")
      await signIn(context, baseURL, "exercise-owner-first");
    const release = Promise.withResolvers<undefined>();
    const arrived = Promise.withResolvers<undefined>();
    const writes: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname === "/api/exercise-attempts/attempt")
        writes.push(req.method());
    });
    await page.route(
      "**/auth/status",
      async (route) => {
        const real = await route.fetch();
        arrived.resolve(undefined);
        await release.promise;
        await route.fulfill({ response: real });
      },
      { times: 1 },
    );
    try {
      await page.goto(lesson, { waitUntil: "commit" });
      await arrived.promise;
      await page.getByRole("button", { name: "2 Промпт", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Ответить ещё раз" }),
      ).toBeVisible();
      const stored = () =>
        page.evaluate((key) => localStorage.getItem(key), storeKey);
      expect(await stored()).toBeNull();
      expect(writes).toEqual([]);
      const accepted = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/auth/status",
      );
      const recorded =
        identity === "account"
          ? page.waitForResponse(
              (r) =>
                new URL(r.url()).pathname === "/api/exercise-attempts/attempt",
            )
          : undefined;
      release.resolve(undefined);
      expect(await (await accepted).json()).toMatchObject(
        identity === "account"
          ? { state: "authenticated", accountId: accountA }
          : { state: "guest" },
      );
      if (recorded) {
        expect(await (await recorded).json()).toMatchObject({
          kind: "ready",
          attempt: {
            exerciseId: "rag-wrong-platform",
            answer: { optionIds: ["prompt"] },
          },
        });
        expect(await stored()).toBeNull();
      } else {
        await expect.poll(stored).toContain('"optionIds":["prompt"]');
      }
      const documentStart = await page.evaluate(() => performance.timeOrigin);
      const retry = page.getByRole("button", { name: "Ответить ещё раз" });
      await retry.evaluate((button) => {
        button.setAttribute("data-before-leaving", "yes");
      });
      await page
        .getByRole("link", { name: /^sachkov\.dev(?:, Главная)?$/u })
        .click();
      await expect(page).toHaveURL(new URL("/", baseURL).href);
      await page.goBack();
      await expect(retry).toHaveAttribute("data-before-leaving", "yes");
      await expect(retry).toBeVisible();
      await signIn(context, baseURL, "exercise-owner-second");
      const changed = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/auth/status",
      );
      const loaded = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/exercise-attempts/query",
      );
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      expect(await (await changed).json()).toMatchObject({
        state: "authenticated",
        accountId: accountB,
      });
      expect(await (await loaded).json()).toMatchObject({
        kind: "ready",
        attempts: [],
      });
      await expect(
        page.getByRole("button", { name: "2 Промпт", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Ответить ещё раз" }),
      ).toHaveCount(0);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(
        documentStart,
      );
      expect(writes).toEqual(identity === "account" ? ["POST"] : []);
    } finally {
      release.resolve(undefined);
    }
  });
}
