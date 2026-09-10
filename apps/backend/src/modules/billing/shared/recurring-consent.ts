import type { BillingContact } from "../../accounts/index.js";
import { subscriptionConsentSchema, type SubscriptionConsent } from "../domain/subscription-change.js";

type ConsentReader = Pick<BillingContact, "readConsent">;
interface AcceptedDocument { readonly kind: string; readonly documentId: string; readonly version: string; readonly digest: string }
interface AcceptedConsent { readonly contextRef: string; readonly acceptedAt: string; readonly document: AcceptedDocument }

async function readAll(contact: ConsentReader, accountId: string, evidenceRefs: readonly string[]): Promise<readonly AcceptedConsent[] | undefined> {
  const results = await Promise.all(evidenceRefs.map(ref => contact.readConsent(accountId, ref)));
  const evidence = results.flatMap(result => result.ok ? [result.evidence] : []);
  const distinct = new Set(evidence.map(item => item.document.kind)).size === evidence.length;
  return evidence.length === evidenceRefs.length && distinct && evidence.some(item => item.document.kind === "recurring") ? evidence : undefined;
}
const sameDocument = (accepted: AcceptedDocument, expected: AcceptedDocument): boolean =>
  accepted.kind === expected.kind && accepted.documentId === expected.documentId
  && accepted.version === expected.version && accepted.digest === expected.digest;

/** Действующее согласие на списание: те же документы тех же редакций, что приняты при покупке. */
export async function verifyRecurringConsent(contact: ConsentReader, accountId: string, consent: unknown): Promise<boolean> {
  const parsed = subscriptionConsentSchema.safeParse(consent);
  if (!parsed.success) return false;
  const evidence = await readAll(contact, accountId, parsed.data.evidenceRefs);
  return evidence !== undefined && parsed.data.documents.every(document => evidence.some(item => sameDocument(item.document, document)));
}

/** Новое явное согласие под конкретную команду и действующие редакции документов. */
export async function acceptRecurringConsent(contact: ConsentReader, accountId: string, contextRef: string,
  evidenceRefs: readonly string[], published: readonly AcceptedDocument[]): Promise<SubscriptionConsent | undefined> {
  const evidence = await readAll(contact, accountId, evidenceRefs);
  if (!evidence) return undefined;
  if (evidence.some(item => item.contextRef !== contextRef || !published.some(document => sameDocument(item.document, document)))) return undefined;
  const first = evidence[0];
  if (!first) return undefined;
  return subscriptionConsentSchema.parse({ evidenceRefs: [...evidenceRefs],
    documents: evidence.map(item => ({ kind: item.document.kind, documentId: item.document.documentId, version: item.document.version, digest: item.document.digest })),
    acceptedAt: first.acceptedAt });
}
