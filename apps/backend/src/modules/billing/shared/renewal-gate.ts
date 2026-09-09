import type { BillingContact } from "../../accounts/index.js";
import { priceSnapshotSchema, type PriceSnapshot } from "../domain/pricing.js";
import { pendingChangeSchema, subscriptionConsentSchema, subscriptionSnapshotSchema } from "../domain/subscription-change.js";

/**
 * Цена продления берётся из принятых условий подписки, а не из публичного каталога.
 * Согласованное изменение варианта применяется следующим периодом.
 */
export function renewalAttemptSnapshot(snapshot: unknown, pendingChange: unknown): PriceSnapshot {
  const pending = pendingChangeSchema.safeParse(pendingChange);
  if (pending.success) return pending.data.snapshot;
  const current = subscriptionSnapshotSchema.parse(snapshot);
  return priceSnapshotSchema.parse({ offer: current.offer, paymentOption: current.paymentOption, promotion: null,
    currency: current.currency, timezone: current.timezone,
    firstPriceKopecks: current.renewalPriceKopecks, renewalPriceKopecks: current.renewalPriceKopecks });
}

/** Действующее согласие на списание: те же документы тех же редакций, что приняты при покупке. */
export async function verifyRecurringConsent(contact: Pick<BillingContact, "readConsent">, accountId: string, consent: unknown): Promise<boolean> {
  const parsed = subscriptionConsentSchema.safeParse(consent);
  if (!parsed.success) return false;
  const results = await Promise.all(parsed.data.evidenceRefs.map(ref => contact.readConsent(accountId, ref)));
  const evidence = results.flatMap(result => result.ok ? [result.evidence] : []);
  if (evidence.length !== parsed.data.evidenceRefs.length) return false;
  return evidence.some(item => item.document.kind === "recurring") && parsed.data.documents.every(document =>
    evidence.some(item => item.document.kind === document.kind && item.document.documentId === document.documentId
      && item.document.version === document.version && item.document.digest === document.digest));
}
