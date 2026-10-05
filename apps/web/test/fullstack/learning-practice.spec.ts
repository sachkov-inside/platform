import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInFullStack } from "../support/full-stack-session";

function practiceSlug(): string {
  const slug = process.env["FULLSTACK_PRACTICE_SLUG"];
  if (slug === undefined) throw new Error("Missing isolated practice fixture");
  return slug;
}

test("practice Reader preserves the ready public body and closed practice geometry", async ({
  page,
  context,
}) => {
  const slug = process.env["FULLSTACK_FREE_PRACTICE_SLUG"];
  if (slug === undefined) throw new Error("Missing free practice fixture");
  await signInFullStack(context, "MEMBER");
  await page.goto(`/materials/${slug}`, { waitUntil: "commit" });
  await expect(page.locator("[data-reader-body]")).toBeVisible();
  const slot = page.locator("[data-practice-slot]");
  const actions = page.locator("[data-material-actions]");
  if (Number(process.env["FULLSTACK_PRACTICE_READ_DELAY_MS"] ?? "0") >= 1000) {
    await expect(slot.getByRole("status")).toBeVisible();
    const before = await actions.boundingBox();
    await expect(
      slot.getByText("Открыть проверку практики", { exact: true }),
    ).toBeVisible();
    const after = await actions.boundingBox();
    expect(before).not.toBeNull();
    expect(after?.y).toBe(before?.y);
    expect((await slot.boundingBox())?.height).toBe(44);
  }
  await page
    .getByRole("button", { name: "Закрыть подключение Telegram" })
    .click();
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Проверка практики" }),
  ).not.toBeVisible();
  await slot.getByText("Открыть проверку практики", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Проверка практики" }),
  ).toBeVisible();
  await expect(slot.getByRole("button", { name: "Копировать" })).toHaveCount(1);
});

test("practice Reader offers pinned requests only to an authorized participant", async ({
  page,
  context,
}, testInfo) => {
  await signInFullStack(context, "MEMBER");
  await page.goto(`/materials/${practiceSlug()}`, { waitUntil: "commit" });
  if (Number(process.env["FULLSTACK_PRACTICE_READ_DELAY_MS"] ?? "0") >= 1000) {
    await expect(
      page.locator('[data-material-reader-state="pending"]'),
    ).toBeVisible();
    await expect(page.locator("[data-reader-body]")).toHaveCount(0);
  }
  await page
    .getByRole("button", { name: "Закрыть подключение Telegram" })
    .click();
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
  const region = page.getByRole("region", { name: "Проверка практики" });
  await expect(region).toBeVisible();
  await expect(region.getByRole("button", { name: "Копировать" })).toHaveCount(
    1,
  );
  await expect(region).toContainText(
    '"practiceId": "synthetic:fullstack-practice"',
  );
  await expect(region).toContainText('"expectedContextVersion"');
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await region.getByRole("button", { name: "Копировать" }).first().click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("synthetic:fullstack-practice");
  expect(copied).toMatch(/"expectedContextVersion": "[a-f0-9]{64}"/u);
  expect(copied).toContain("учебным MCP");
  expect(copied).not.toContain("FULLSTACK_PRIVATE_PRACTICE_BODY");
  await region.getByText("Настройка проверки", { exact: true }).click();
  await expect(
    region.getByRole("link", {
      name: "Открыть инструкцию для ручного подключения",
    }),
  ).toHaveAttribute("href", "/practice-review-setup.txt");
  const setup = await page.request.get("/practice-review-setup.txt");
  expect(setup.status()).toBe(200);
  expect(await setup.text()).toContain("/mcp/learning");
  // Запрос подключения агента виден после раскрытия настройки и ведёт на ту же инструкцию.
  await expect(
    region.getByText("Подключить агента", { exact: true }),
  ).toBeVisible();
  await expect(region).toContainText("/practice-review-setup.txt");
  await region.getByText("Настройка проверки", { exact: true }).click();
  const violations = (
    await new AxeBuilder({ page })
      .include('[aria-label="Проверка практики"]')
      .analyze()
  ).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(violations).toEqual([]);
  const evidence = await prepareEvidenceDirectory("issue-785");
  await region.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(evidence, `reader-${testInfo.project.name}.png`),
    animations: "disabled",
    fullPage: false,
  });
  await writeFile(
    resolve(evidence, `reader-${testInfo.project.name}.json`),
    JSON.stringify(
      {
        viewport: page.viewportSize(),
        violations,
        delayedPracticeReadMs: Number(
          process.env["FULLSTACK_PRACTICE_READ_DELAY_MS"] ?? "0",
        ),
        copiedStablePracticeId: copied.includes("synthetic:fullstack-practice"),
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

test("practice Reader keeps assignment metadata and protected body out of guest and denied views", async ({
  page,
  context,
  request,
}) => {
  const api = process.env["FULLSTACK_API_BASE_URL"];
  if (api === undefined) throw new Error("Missing isolated API URL");
  const anonymous = await request.get(
    `${api}/library/materials/${practiceSlug()}/practices`,
  );
  expect(anonymous.status()).toBe(404);
  expect(await anonymous.text()).not.toContain("Бриф консультаций");
  await page.goto(`/materials/${practiceSlug()}`);
  await expect(
    page.getByRole("region", { name: "Проверка практики" }),
  ).toHaveCount(0);
  await expect(page.getByText(/FULLSTACK_PRIVATE_PRACTICE_BODY/u)).toHaveCount(
    0,
  );
  await signInFullStack(context, "NON_MEMBER");
  await page.goto(`/materials/${practiceSlug()}`);
  await expect(
    page.getByRole("region", { name: "Проверка практики" }),
  ).toHaveCount(0);
  await expect(page.getByText(/FULLSTACK_PRIVATE_PRACTICE_BODY/u)).toHaveCount(
    0,
  );
});
