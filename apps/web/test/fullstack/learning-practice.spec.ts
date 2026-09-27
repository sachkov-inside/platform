import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInFullStack } from "../support/full-stack-session";

function practiceSlug(): string {
  const slug = process.env["FULLSTACK_PRACTICE_SLUG"];
  if (slug === undefined) throw new Error("Missing isolated practice fixture");
  return slug;
}

test("practice Reader offers pinned requests only to an authorized participant", async ({
  page,
  context,
}) => {
  await signInFullStack(context, "MEMBER");
  await page.goto(`/materials/${practiceSlug()}`);
  const region = page.getByRole("region", { name: "Проверка практики" });
  await expect(region).toBeVisible();
  await expect(region.getByRole("button", { name: "Копировать" })).toHaveCount(
    2,
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
  expect(copied).toContain("Codex");
  expect(copied).not.toContain("FULLSTACK_PRIVATE_PRACTICE_BODY");
  const violations = (
    await new AxeBuilder({ page })
      .include('[aria-label="Проверка практики"]')
      .analyze()
  ).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(violations).toEqual([]);
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
