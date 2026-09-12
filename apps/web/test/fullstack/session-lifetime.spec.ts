import { expect, test } from "@playwright/test";

import {
  addFullStackSessionCookie,
  fullStackBaseUrl,
  signInFullStack,
} from "../support/full-stack-session";

/**
 * Срок сессии в наборе. Доступ живёт пять минут и проверяется приложением, а набор идёт дольше
 * получаса, поэтому продление обязано работать — иначе тесты с входом падают тем позже, чем
 * дальше они от старта, и падение выглядит дефектом страницы. Обе проверки работают с уже
 * истёкшим доступом, поэтому ждать пять минут не нужно.
 */
test("renews an access token that has already run out", async ({
  context,
  page,
}) => {
  await signInFullStack(context, "FULLSTACK_LOGTO_SESSION_PAST_EXPIRY");

  await page.goto("/materials/kak-ustroen-inside-platform");
  const action = page.locator("[data-reading-action-state]:visible");
  await expect(action).toHaveAttribute("data-reading-action-state", "ready");
});

test("reports a session it cannot renew as signed out", async ({ context }) => {
  await addFullStackSessionCookie(
    context,
    "FULLSTACK_LOGTO_SESSION_WITHOUT_RENEWAL",
  );

  const status = await context.request.get(`${fullStackBaseUrl()}/auth/status`);

  expect(status.ok()).toBe(true);
  expect(await status.json()).toMatchObject({ state: "guest" });
});
