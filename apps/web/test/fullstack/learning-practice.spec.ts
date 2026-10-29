import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInFullStack } from "../support/full-stack-session";

function practiceSlug(): string {
  const slug = process.env["FULLSTACK_PRACTICE_SLUG"];
  if (slug === undefined)
    throw new Error("Missing isolated practical Task fixture");
  return slug;
}

test("practical Task Reader preserves the ready public body while its personal workspace streams", async ({
  page,
  context,
}) => {
  const slug = process.env["FULLSTACK_FREE_PRACTICE_SLUG"];
  if (slug === undefined)
    throw new Error("Missing free practical Task fixture");
  // A free Product lesson opens to a reader signed in through Telegram without a purchase (#1825).
  await signInFullStack(context, "NON_MEMBER");
  await page.goto(`/materials/${slug}`, { waitUntil: "commit" });
  const body = page.locator("[data-reader-body]");
  await expect(body).toBeVisible();
  const before = await body.boundingBox();
  const workspace = page.getByRole("region", {
    name: "Сдача задания",
    exact: true,
  });
  await expect(workspace).toBeVisible();
  expect((await body.boundingBox())?.y).toBe(before?.y);
  await expect(workspace.locator("[data-agent-phrase]")).toContainText(
    "fullstack-practice-free",
  );
  await expect(
    workspace.getByRole("button", { name: "Скопировать запрос", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("dialog", { name: "Подключите Telegram" }),
  ).toHaveCount(0);
});

test("practical Task Reader offers the current agent request only to an authorized participant", async ({
  page,
  context,
}, testInfo) => {
  await signInFullStack(context, "MEMBER");
  await page.goto(`/materials/${practiceSlug()}`, { waitUntil: "commit" });
  await expect(page.locator("[data-reader-body]")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Подключите Telegram" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
  const region = page.getByRole("region", {
    name: "Сдача задания",
    exact: true,
  });
  await expect(region).toBeVisible();
  const phrase = region.locator("[data-agent-phrase]");
  await expect(phrase).toContainText("fullstack-practice-closed");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await phrase
    .getByRole("button", { name: "Скопировать запрос", exact: true })
    .click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(
    "Проверь моё задание fullstack-practice-closed через учебный MCP Sachkov Dev и помоги его сдать.",
  );
  expect(copied).not.toContain("FULLSTACK_PRIVATE_PRACTICE_BODY");
  expect(copied).not.toContain("learning_practice_read");
  await region
    .getByRole("button", { name: "Настроить подключение", exact: true })
    .click();
  await expect(region.locator("[data-task-connection]")).toContainText(
    "/mcp/learning",
  );
  const setup = await page.request.get("/practice-review-setup.txt");
  expect(setup.status()).toBe(200);
  expect(await setup.text()).toContain("learning_task_read");
  await region
    .getByText("Подробная инструкция и помощь", { exact: true })
    .click();
  await expect(
    region.getByRole("status", { name: "Загружаем инструкцию…" }),
  ).toHaveCount(0);
  await expect(
    region.getByText("Проверка подключения и помощь", { exact: true }),
  ).toBeVisible();
  const violations = (
    await new AxeBuilder({ page })
      .include('[aria-labelledby="task-submit-heading"]')
      .analyze()
  ).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(violations).toEqual([]);
  const evidence = await prepareEvidenceDirectory("issue-1710");
  await region.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(
      evidence,
      `practical-task-reader-${testInfo.project.name}.png`,
    ),
    animations: "disabled",
    fullPage: false,
  });
  await writeFile(
    resolve(evidence, `practical-task-reader-${testInfo.project.name}.json`),
    JSON.stringify(
      {
        viewport: page.viewportSize(),
        violations,
        currentTaskCode: "fullstack-practice-closed",
        copied,
      },
      null,
      2,
    ),
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});

test("practical Task Reader keeps protected requirements and body out of guest and denied views", async ({
  page,
  context,
  request,
}) => {
  const api = process.env["FULLSTACK_API_BASE_URL"];
  const materialId = process.env["FULLSTACK_PRACTICE_MATERIAL_ID"];
  if (api === undefined || materialId === undefined)
    throw new Error("Missing isolated API/material fixture");
  const anonymous = await request.get(
    `${api}/library/materials/${materialId}/task`,
  );
  expect(anonymous.status()).toBe(200);
  expect(await anonymous.json()).toMatchObject({ access: "closed" });
  expect(await anonymous.text()).not.toContain("Чужая заявка не раскрывается.");
  expect(await anonymous.text()).not.toContain(
    "FULLSTACK_PRIVATE_PRACTICE_BODY",
  );
  await page.goto(`/materials/${practiceSlug()}`);
  await expect(
    page.getByRole("region", { name: "Сдача задания", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/FULLSTACK_PRIVATE_PRACTICE_BODY/u)).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Чужая заявка не раскрывается.", { exact: true }),
  ).toHaveCount(0);
  await signInFullStack(context, "NON_MEMBER");
  await page.goto(`/materials/${practiceSlug()}`);
  await expect(
    page.getByRole("region", { name: "Сдача задания", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/FULLSTACK_PRIVATE_PRACTICE_BODY/u)).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Чужая заявка не раскрывается.", { exact: true }),
  ).toHaveCount(0);
});
