import { z } from "zod";
import { createPrismaClient } from "../../../src/infrastructure/prisma/index.js";
import { assembleAccounts, BillingContact } from "../../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../../src/modules/membership-entitlements/index.js";
import { BillingPayments } from "../../../src/modules/billing/index.js";
import { Tbank } from "../../../src/modules/billing/infrastructure/tbank/tbank.js";
import { tbankRuntimeSchema } from "../../../src/config/tbank-config.js";
const input = z.object({ databaseUrl: z.string(), config: tbankRuntimeSchema, buyer: z.uuid(), command: z.unknown(), now: z.string(), notification: z.unknown().optional(),
  documents: z.array(z.object({ kind: z.enum(["terms", "recurring"]), appliesTo: z.array(z.enum(["one_time", "subscription"])).readonly(), documentId: z.string(), version: z.string(), text: z.string(), digest: z.string(), url: z.string() }))
}).parse(JSON.parse(process.env.BILLING_CRASH_FIXTURE ?? "null"));
const prisma = createPrismaClient(input.databaseUrl);
const clock = () => new Date(input.now);
const accounts = assembleAccounts({ prisma, emailFingerprintKey: "synthetic-billing-fingerprint-key-000000" });
const contact = new BillingContact({ prisma, protection: billingContactProtection(Buffer.alloc(32, 42).toString("base64")), documents: input.documents, now: clock,
  sendCode: () => Promise.reject(new Error("No email in crash recovery fixture")) });
const bank = new Tbank(input.config, async (_url, options) => {
  if (typeof options?.body !== "string") throw new Error("Invalid fixture request");
  const body = z.object({ OrderId: z.uuid() }).parse(JSON.parse(options.body));
  process.send?.({ purchaseRef: body.OrderId });
  await new Promise(() => undefined);
  throw new Error("Child must be killed while provider result is unknown");
});
const payments = new BillingPayments({ prisma, contact, grants: assembleAccessGrants({ prisma, accounts, clock }), bank, clock });
if (input.notification) {
  const result = await payments.notification(input.notification);
  if (!result.ok) throw new Error(result.error.code);
  process.send?.("confirmed");
  await new Promise(() => undefined);
} else await payments.purchase(input.buyer, input.command);
