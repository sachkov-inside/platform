import { expect, test } from "@playwright/test";

import {
  addFullStackSessionCookie,
  fullStackSessionState,
  signInFullStack,
} from "../support/full-stack-session";

/**
 * Срок сессии в наборе. Доступ живёт пять минут и проверяется приложением, а набор идёт дольше
 * получаса, поэтому продление обязано работать — иначе тесты с входом падают тем позже, чем
 * дальше они от старта, и падение выглядит дефектом страницы. Все три проверки начинаются с уже
 * истёкшего доступа, поэтому ждать пять минут не нужно. Cookie ставится без проверки входа:
 * именно её здесь и проверяют, а не берут как данность.
 */
test("renews an access token that has already run out", async ({ context }) => {
  await addFullStackSessionCookie(context, "PAST_EXPIRY");

  await expect(fullStackSessionState(context)).resolves.toBe("authenticated");
});

test("reports a session it cannot renew as signed out", async ({ context }) => {
  await addFullStackSessionCookie(context, "WITHOUT_RENEWAL");

  await expect(fullStackSessionState(context)).resolves.toBe("guest");
});

test("names the expired session when signing in cannot succeed", async ({
  context,
}) => {
  // Сломанное продление обязано читаться как истёкшая сессия. Именно это сообщение отличает
  // «сессия кончилась» от «страница сломалась» в середине длинного набора.
  await expect(signInFullStack(context, "WITHOUT_RENEWAL")).rejects.toThrow(
    /session WITHOUT_RENEWAL is signed out[\s\S]*expired session/u,
  );
});
