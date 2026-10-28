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
}) => {
  await signInFullStack(context, "OWNER");
  await page.goto("/authoring/sales/links");
  // This scenario owns its mutable price; saved-link fixtures and other scenarios keep theirs.
  const created = await fullStackBrowserJsonRequest(
    page,
    "/api/authoring/collections",
    "POST",
    {
      kind: "product",
      name: "Synthetic price editing",
      slug: `price-editing-${randomUUID()}`,
      summary: "Isolated catalogue editing fixture",
    },
  );
  const { collection: ownedProduct } = z
    .object({
      kind: z.literal("saved"),
      collection: z.object({ id: z.uuid() }),
    })
    .parse(await created.json());
  const saved = await fullStackBrowserJsonRequest(
    page,
    "/api/authoring/billing/product-prices/save",
    "POST",
    {
      operationId: randomUUID(),
      value: {
        productId: ownedProduct.id,
        name: "Synthetic price editing",
        priceKopecks: 10000,
        published: false,
      },
    },
  );
  expect(await saved.json()).toMatchObject({ ok: true });
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
  const snapshot = catalogue.find(
    (item) => item.product?.id === ownedProduct.id,
  );
  if (!snapshot?.product)
    throw new Error("Owned full-stack Product price is missing");
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
  expect(
    afterCatalogue.filter((item) => item.product?.id !== product.id),
  ).toEqual(catalogue.filter((item) => item.product?.id !== product.id));
  const after = afterCatalogue.find((item) => item.product?.id === product.id);
  expect(after).toMatchObject({
    product: { id: product.id, priceRevision: product.priceRevision + 1 },
    paymentOption: { priceKopecks: input.value.priceKopecks },
  });
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
