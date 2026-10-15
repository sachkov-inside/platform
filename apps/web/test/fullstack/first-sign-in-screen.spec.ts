import { expect, test } from "@playwright/test";

import { passFirstSignInScreen } from "../support/full-stack-session";

const acceptLabel = "Принять условия и продолжить";

// These cases exercise the real helper against committed browser states. They do not retry
// the unavailable state or stand in for a successful first sign-in against the live API.
test("first sign-in reports unavailable terms instead of a navigation timeout", async ({
  context,
}) => {
  await context.route("**/welcome?returnTo=%2F", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<dialog open><p role="alert">Условия сейчас не удаётся загрузить. Обновите страницу немного позже.</p></dialog>',
    }),
  );

  await expect(passFirstSignInScreen(context)).rejects.toThrow(
    "First sign-in could not load the terms: the welcome screen reported unavailable terms.",
  );
  expect(context.pages()).toHaveLength(0);
});

test("first sign-in waits for the modal before accepting", async ({
  context,
}) => {
  await context.route("**/welcome?returnTo=%2F", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<dialog open><button>${acceptLabel}</button></dialog>`,
    }),
  );
  await context.route("**/", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "Accepted",
    }),
  );
  const opened = context.waitForEvent("page");
  const signingIn = passFirstSignInScreen(context);
  const welcome = await opened;
  await expect(
    welcome.getByRole("button", { name: acceptLabel }),
  ).toBeVisible();
  // A button in the server-rendered dialog is visible before its action is hydrated.
  await welcome.evaluate(() => {
    const dialog = document.querySelector("dialog");
    const button = document.querySelector("button");
    if (dialog === null || button === null)
      throw new Error("Missing welcome fixture");
    button.onclick = () => location.assign("/");
    dialog.close();
    dialog.showModal();
  });
  await signingIn;
  expect(context.pages()).toHaveLength(0);
});

test("first sign-in permits the already-accepted redirect", async ({
  context,
}) => {
  await context.route("**/welcome?returnTo=%2F", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<script>addEventListener("load", () => location.assign("/"))</script>',
    }),
  );
  await context.route("**/", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "Already accepted",
    }),
  );

  await passFirstSignInScreen(context);
  expect(context.pages()).toHaveLength(0);
});
