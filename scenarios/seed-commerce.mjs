// @ts-check
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isolatedScenarioApi } from "./isolated-api.mjs";
import { commerceScenario } from "./commerce.mjs";

/**
 * Real Account/link lifecycle against the caller's owned API and external provider.
 * @param {{api: string; databaseName: string; productId: string; ownerToken: string; buyerToken: string; completeTelegramLink: (deepLink: string) => void | Promise<void>; createIntake: () => Promise<void>}} input
 */
export async function seedCommerceScenario(input) {
  const request = isolatedScenarioApi(input);
  const buyer = z
    .object({ account: z.object({ accountId: z.uuid() }) })
    .loose()
    .parse(await request("POST", "/accounts", undefined, input.buyerToken));
  const terms = z
    .object({
      document: z.object({ version: z.string(), digest: z.string() }).loose(),
    })
    .loose()
    .parse(
      await request(
        "GET",
        "/accounts/current/legal-acceptances/terms",
        undefined,
        input.buyerToken,
      ),
    );
  await request(
    "POST",
    "/accounts/current/legal-acceptances/terms",
    {
      operationId: randomUUID(),
      version: terms.document.version,
      digest: terms.document.digest,
      buttonLabel: "Учебная подготовка участника",
    },
    input.buyerToken,
  );
  const link = z
    .discriminatedUnion("status", [
      z
        .object({
          status: z.literal("pending"),
          linkRef: z.uuid(),
          deepLink: z.url(),
        })
        .loose(),
      z.object({ status: z.literal("linked"), linkRef: z.uuid() }).loose(),
    ])
    .parse(
      await request(
        "POST",
        "/accounts/current/telegram-link",
        undefined,
        input.buyerToken,
      ),
    );
  if (link.status === "pending") {
    await input.completeTelegramLink(link.deepLink);
    z.object({ status: z.literal("linked"), linkRef: z.uuid() })
      .loose()
      .parse(
        await request(
          "POST",
          `/accounts/current/telegram-link/${link.linkRef}/confirm`,
          undefined,
          input.buyerToken,
        ),
      );
  }
  await input.createIntake();
  await request(
    "POST",
    "/product-waitlists/join",
    {
      intakeId: commerceScenario.waitlist.intakeId,
      operationId: randomUUID(),
      source: commerceScenario.waitlist.source,
    },
    input.buyerToken,
  );
  const price = z
    .object({
      result: z.object({
        outcome: z.literal("catalog"),
        value: z.object({ revision: z.number().int().positive() }).loose(),
      }),
    })
    .loose()
    .parse(
      await request("POST", "/billing/admin", {
        operation: "productPrices.save",
        operationId: randomUUID(),
        value: {
          productId: input.productId,
          name: commerceScenario.product.name,
          priceKopecks: commerceScenario.priceKopecks,
          published: true,
        },
      }),
    );
  const quote = z
    .object({ quoteRef: z.uuid() })
    .loose()
    .parse(
      await request(
        "POST",
        "/accounts/current/billing/quote",
        {
          operationId: randomUUID(),
          productId: input.productId,
          priceRevision: price.result.value.revision,
        },
        input.buyerToken,
      ),
    );
  const contact = z
    .object({
      ok: z.literal(true),
      documents: z.array(
        z
          .object({
            kind: z.string(),
            commercialModel: z.string().optional(),
            appliesTo: z.array(z.string()),
            documentId: z.string(),
            version: z.string(),
            digest: z.string(),
          })
          .loose(),
      ),
    })
    .loose()
    .parse(
      await request(
        "GET",
        "/accounts/current/billing/contact",
        undefined,
        input.buyerToken,
      ),
    );
  const purchaseTerms = contact.documents.find(
    (document) =>
      document.kind === "terms" &&
      document.commercialModel === "product-lifetime-v1" &&
      document.appliesTo.includes("one_time"),
  );
  if (purchaseTerms === undefined)
    throw new Error("Synthetic Product purchase terms are unavailable");
  const consent = z
    .object({ ok: z.literal(true), evidenceRefs: z.array(z.uuid()).min(1) })
    .loose()
    .parse(
      await request(
        "POST",
        "/accounts/current/billing/consents",
        {
          operationId: randomUUID(),
          contextRef: quote.quoteRef,
          screen: "checkout",
          buttonLabel: commerceScenario.checkoutButtonLabel,
          documents: [
            {
              kind: "terms",
              documentId: purchaseTerms.documentId,
              version: purchaseTerms.version,
              digest: purchaseTerms.digest,
              accepted: true,
            },
          ],
        },
        input.buyerToken,
      ),
    );
  const purchase = z
    .object({
      purchaseRef: z.uuid(),
      state: z.literal(commerceScenario.paymentState),
      paymentUrl: z.url(),
    })
    .loose()
    .parse(
      await request(
        "POST",
        "/accounts/current/billing/purchase",
        {
          operationId: randomUUID(),
          quoteRef: quote.quoteRef,
          consentEvidenceRefs: consent.evidenceRefs,
        },
        input.buyerToken,
      ),
    );
  return {
    buyerAccountId: buyer.account.accountId,
    purchaseRef: purchase.purchaseRef,
    paymentUrl: purchase.paymentUrl,
  };
}
