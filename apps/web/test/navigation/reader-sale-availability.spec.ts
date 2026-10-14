import { expect, test } from "@playwright/test";
import { z } from "zod";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT required");
const backend = `http://127.0.0.1:${backendPort}`;
const journalSchema = z.object({
  reads: z.array(
    z.object({
      path: z.string(),
      authorized: z.boolean(),
      bytes: z.number(),
      status: z.number(),
    }),
  ),
});

for (const size of [1, 10, 100]) {
  for (const scenario of ["none", "sole", "multiple", "explicit"] as const) {
    test(`Reader sale ${String(size)} memberships preserves ${scenario} with bounded admission`, async ({
      page,
      request,
    }, info) => {
      await request.post(`${backend}/__reader-sale`, { data: { reset: true } });
      const slug = `reader-sale-${String(size)}-${scenario}`;
      const selected = scenario === "explicit" ? Math.min(2, size) : size;
      const productSlug = `reader-sale-product-${String(size)}-${scenario}-${String(selected)}`;
      const from = `/products/${productSlug}/programme`;
      await page.goto(
        `/materials/${slug}${scenario === "explicit" ? `?from=${encodeURIComponent(from)}` : ""}`,
        { waitUntil: "commit" },
      );
      await expect(
        page.locator('[data-material-reader-state="access-required"]'),
      ).toBeVisible();
      const invitation = page.getByRole("link", {
        name: "Купить продукт",
        exact: true,
      });
      if (
        scenario === "sole" ||
        scenario === "explicit" ||
        (scenario === "multiple" && size === 1)
      ) {
        await expect(invitation).toBeVisible();
        await expect(invitation).toHaveAttribute(
          "href",
          `/products/${scenario === "multiple" ? `reader-sale-product-${String(size)}-${scenario}-1` : productSlug}/buy`,
        );
      } else {
        await expect(invitation).toHaveCount(0);
        await expect(
          page.getByText(
            "Купить доступ сейчас нельзя, но материал останется здесь.",
          ),
        ).toBeVisible();
      }
      const { reads } = journalSchema.parse(
        await (await request.get(`${backend}/__reader-sale`)).json(),
      );
      const admission = reads.filter(({ path }) =>
        path.startsWith("/library/products/sale-availability?"),
      );
      const programme = reads.filter(({ path }) =>
        path.startsWith("/library/products/reader-sale-product-"),
      );
      await info.attach(
        `reader-sale-${String(size)}-${scenario}-physical-http`,
        {
          body: JSON.stringify({
            reads,
            admissionRequests: admission.length,
            programmeNavigationRequests: programme.length,
            selectedRequestBytes: reads.reduce(
              (sum, read) => sum + read.bytes,
              0,
            ),
          }),
          contentType: "application/json",
        },
      );
      expect(admission).toHaveLength(1);
      expect(
        new URL(admission[0]?.path ?? "", backend).searchParams.getAll(
          "productId",
        ),
      ).toHaveLength(scenario === "explicit" ? 1 : size);
      expect(
        reads.filter(({ path }) => path.startsWith("/billing/")),
      ).toHaveLength(0);
      expect(programme).toHaveLength(scenario === "explicit" ? 1 : 0);
      expect(reads.every(({ authorized }) => !authorized)).toBe(true);
    });
  }
}

for (const scenario of ["unavailable", "malformed", "missing"] as const) {
  test(`Reader keeps ${scenario} admission unavailable rather than no-sale`, async ({
    page,
    request,
  }, info) => {
    await request.post(`${backend}/__reader-sale`, { data: { reset: true } });
    await page.goto(`/materials/reader-sale-10-${scenario}`, {
      waitUntil: "commit",
    });
    await expect(
      page.getByRole("button", { name: "Повторить", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Купить продукт", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "Купить доступ сейчас нельзя, но материал останется здесь.",
      ),
    ).toHaveCount(0);
    const { reads } = journalSchema.parse(
      await (await request.get(`${backend}/__reader-sale`)).json(),
    );
    expect(
      reads.filter(({ path }) =>
        path.startsWith("/library/products/sale-availability?"),
      ),
    ).toHaveLength(scenario === "unavailable" ? 1 : 0);
    await info.attach(`reader-sale-${scenario}-physical-http`, {
      body: JSON.stringify({ reads }),
      contentType: "application/json",
    });
    if (scenario === "unavailable") {
      await request.post(`${backend}/__reader-sale`, {
        data: { reset: true, unavailable: false },
      });
      await page
        .getByRole("button", { name: "Повторить", exact: true })
        .click();
      await expect(
        page.locator('[data-material-reader-state="access-required"]'),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Купить доступ сейчас нельзя, но материал останется здесь.",
        ),
      ).toBeVisible();
    }
  });
}
