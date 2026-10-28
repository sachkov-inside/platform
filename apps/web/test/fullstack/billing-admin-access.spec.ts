import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  fullStackBrowserJsonRequest,
  fullStackBrowserRequest,
  signInFullStack,
} from "../support/full-stack-session";

test("owner edits one Product price and reloads the actual catalogue without tariff controls", async ({
  context,
  page,
}, testInfo) => {
  await signInFullStack(context, "OWNER");
  await page.goto("/authoring/sales/links");
  const initial = await fullStackBrowserRequest(
    page,
    "/api/authoring/billing/catalog",
  );
  const schema = z.object({
    ok: z.literal(true),
    value: z.object({
      items: z.array(
        z.object({
          product: z
            .object({
              id: z.uuid(),
              name: z.string(),
              priceRevision: z.int().positive(),
            })
            .optional(),
          paymentOption: z.object({ priceKopecks: z.int() }),
        }),
      ),
    }),
  });
  const catalogue = schema.parse(await initial.json()).value.items;
  const fixtures = z
    .record(
      z.string(),
      z.object({ productId: z.uuid(), adminProductId: z.uuid() }),
    )
    .parse(
      JSON.parse(process.env["FULLSTACK_PAYMENT_LINKS_FIXTURE"] ?? "null"),
    );
  const adminProductId = fixtures[testInfo.project.name]?.adminProductId;
  expect(adminProductId).toBeDefined();
  const savedProducts = new Set(
    Object.values(fixtures).map((fixture) => fixture.productId),
  );
  expect(savedProducts.has(adminProductId ?? "")).toBe(false);
  const savedPrices = catalogue.filter((item) =>
    savedProducts.has(item.product?.id ?? ""),
  );
  expect(savedPrices).toHaveLength(2);
  const snapshot = catalogue.find(
    (item) => item.product?.id === adminProductId,
  );
  if (!snapshot?.product)
    throw new Error("Disposable full-stack Product price is missing");
  const product = snapshot.product;
  const input = {
    operationId: randomUUID(),
    expectedRevision: product.priceRevision,
    value: {
      productId: product.id,
      name: product.name,
      priceKopecks: snapshot.paymentOption.priceKopecks + 100,
      published: false,
    },
  };
  const result = await fullStackBrowserJsonRequest(
    page,
    "/api/authoring/billing/product-prices/save",
    "POST",
    input,
  );
  expect(await result.json()).toMatchObject({ ok: true });
  await page.reload();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Ссылки на оплату",
      exact: true,
    }),
  ).toBeVisible();
  const afterCatalogue = schema.parse(
    await (
      await fullStackBrowserRequest(page, "/api/authoring/billing/catalog")
    ).json(),
  ).value.items;
  const after = afterCatalogue.find((item) => item.product?.id === product.id);
  expect(after).toMatchObject({
    product: { id: product.id, priceRevision: product.priceRevision + 1 },
    paymentOption: { priceKopecks: input.value.priceKopecks },
  });
  expect(
    afterCatalogue.filter((item) => savedProducts.has(item.product?.id ?? "")),
    "editing an admin Product must preserve the saved payment-link Products",
  ).toEqual(savedPrices);
  for (const name of ["Тарифы", "Приглашения", "Перенос Tribute"])
    await expect(page.getByRole("tab", { name, exact: true })).toHaveCount(0);
  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(
    scan.violations.filter(
      (item) => item.impact === "serious" || item.impact === "critical",
    ),
  ).toEqual([]);
});
test("retired commerce routes remain absent for a signed-in owner", async ({
  context,
  page,
}) => {
  await signInFullStack(context, "OWNER");
  await page.goto("/authoring/people");
  for (const path of [
    "/api/authoring/billing/offers/save",
    "/api/authoring/billing/payment-options/save",
    "/api/authoring/billing/invitations/issue",
    "/api/authoring/billing/tribute/apply",
    "/api/authoring/billing/grants/extend",
  ]) {
    const result = await fullStackBrowserJsonRequest(page, path, "POST", {
      operationId: randomUUID(),
    });
    expect(result.status(), path).toBe(404);
  }
});
