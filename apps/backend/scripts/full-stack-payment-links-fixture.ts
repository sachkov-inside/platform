import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { loadPlatformConfig } from "../src/config/load-platform-config.js";
import { createPrismaClient } from "../src/infrastructure/prisma/index.js";
import {
  assembleAccounts,
  BillingContact,
} from "../src/modules/accounts/index.js";
import { BillingPricing } from "../src/modules/billing/index.js";
import { CoverageCatalog } from "../src/modules/materials/index.js";
import { ProductDiscovery } from "../src/modules/products/index.js";

/** Test composition only. Seed already saved links; the running API keeps its actual legal source. */
async function main() {
  const config = loadPlatformConfig();
  const environment = z
    .object({
      FULLSTACK_FIXTURE_API_ORIGIN: z.url(),
      FULLSTACK_FIXTURE_OWNER_TOKEN: z.string().min(1),
      FULLSTACK_PAYMENT_LINKS_FIXTURE_FILE: z.string().min(1),
      OWNER_LOGTO_SUBJECT: z.string().min(1),
    })
    .parse(process.env);
  const origin = new URL(environment.FULLSTACK_FIXTURE_API_ORIGIN);
  const database = new URL(config.database.url);
  if (
    config.mode !== "development" ||
    config.identity.issuer !== "https://identity.fullstack.test/oidc" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname) ||
    !["127.0.0.1", "localhost"].includes(database.hostname) ||
    database.pathname !== "/inside_checks" ||
    config.tbank?.environment !== "local"
  )
    throw new Error("Expected the isolated synthetic full-stack fixture");
  const prisma = createPrismaClient(config.database.url);
  try {
    const owner = await prisma.account.findUniqueOrThrow({
      where: {
        logtoIssuer_logtoSubject: {
          logtoIssuer: config.identity.issuer,
          logtoSubject: environment.OWNER_LOGTO_SUBJECT,
        },
      },
      select: { id: true },
    });
    const accounts = assembleAccounts({
      prisma,
      emailFingerprintKey: "synthetic-existing-link-fixture-fingerprint-key",
    });
    const text =
      "Synthetic Product lifetime and three-month support test fixture, never published legal terms";
    const contact = new BillingContact({
      prisma,
      emailFingerprintKey: "synthetic-existing-link-fixture-fingerprint-key",
      protection: undefined,
      sendCode: undefined,
      now: () => new Date(),
      documents: [
        {
          kind: "terms",
          documentId: "synthetic-product-terms",
          version: "fixture-existing-link-v1",
          text,
          digest: createHash("sha256").update(text).digest("hex"),
          url: "https://synthetic.invalid/legal/fixture-existing-link-v1",
          appliesTo: ["one_time"],
          commercialModel: "product-lifetime-v1",
        },
      ],
    });
    const pricing = new BillingPricing({
      prisma,
      accounts,
      contentCatalog: new CoverageCatalog(prisma, new ProductDiscovery(prisma)),
      sale: {
        payments: contact.hasApprovedProductTerms(),
        amountLimits: {
          minimumKopecks: config.tbank.minimumKopecks,
          maximumKopecks: config.tbank.maximumKopecks,
        },
      },
    });
    const fixtures: Record<
      string,
      {
        productId: string;
        adminProductId: string;
        linkId: string;
        revision: number;
      }
    > = {};
    for (const profile of ["desktop-chromium", "mobile-chromium"]) {
      const reserveProduct = async (
        purpose: "existing-private-link" | "admin-price",
      ) => {
        const created = await fetch(
          new URL("/authoring/import/products/reserve", origin),
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${environment.FULLSTACK_FIXTURE_OWNER_TOKEN}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              sourceId: `synthetic:${purpose}:${profile}`,
              name: `Synthetic ${purpose} ${profile}`,
              slug: `synthetic-${purpose}-${profile}`,
              summary: "Isolated full-stack pricing fixture",
            }),
          },
        );
        if (!created.ok)
          throw new Error(
            `Product fixture reservation failed: HTTP ${created.status}`,
          );
        return z.object({ id: z.uuid() }).parse(await created.json());
      };
      const product = await reserveProduct("existing-private-link");
      const adminProduct = await reserveProduct("admin-price");
      const adminPrice = await pricing.manage(owner.id, {
        operation: "productPrices.save",
        operationId: randomUUID(),
        value: {
          productId: adminProduct.id,
          name: `Admin price ${profile}`,
          priceKopecks: 2900000,
          published: false,
        },
      });
      if (!adminPrice.ok)
        throw new Error(
          `Admin Product price fixture: ${adminPrice.error.code}`,
        );
      const price = await pricing.manage(owner.id, {
        operation: "productPrices.save",
        operationId: randomUUID(),
        value: {
          productId: product.id,
          name: `Saved private link ${profile}`,
          priceKopecks: 2900000,
          published: false,
        },
      });
      if (!price.ok)
        throw new Error(`Product price fixture: ${price.error.code}`);
      const link = await pricing.managePaymentLink(owner.id, {
        operation: "paymentLinks.create",
        operationId: randomUUID(),
        productId: product.id,
        priceRevision: 1,
        price: { kind: "discount", percent: 10 },
        expiresAt: null,
      });
      if (!link.ok) throw new Error(`Saved link fixture: ${link.error.code}`);
      fixtures[profile] = {
        productId: product.id,
        adminProductId: adminProduct.id,
        linkId: link.value.id,
        revision: link.value.revision,
      };
    }
    await writeFile(
      environment.FULLSTACK_PAYMENT_LINKS_FIXTURE_FILE,
      JSON.stringify(fixtures),
      { mode: 0o600 },
    );
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch(() => {
  console.error("Synthetic saved payment-link fixture failed");
  process.exitCode = 1;
});
