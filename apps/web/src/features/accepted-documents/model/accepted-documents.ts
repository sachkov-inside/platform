import {
  legalDocumentKeys,
  type LegalDocumentKey,
} from "@inside/legal/document";
import type { Route } from "next";
import { z } from "zod";

import { legalNavigationEntry } from "@/entities/legal-document";
import {
  renewalTermsLine,
  shownRenewalTermsSchema,
} from "@/entities/subscription";
import { legalEditionPath } from "@/shared/routing/public-page-path";

export const acceptedDocumentSchema = z.object({
  acceptanceRef: z.uuid(),
  documentId: z.string(),
  version: z.string(),
  url: z.url({ protocol: /^https?$/u }),
  acceptedAt: z.iso.datetime(),
  screen: z
    .enum(["first-sign-in", "checkout", "subscription-resume"])
    .nullable(),
  buttonLabel: z.string().nullable(),
  shownTerms: shownRenewalTermsSchema.nullable(),
});
export const acceptedDocumentsSchema = z.object({
  ok: z.literal(true),
  documents: z.array(acceptedDocumentSchema),
});
export type AcceptedDocument = z.infer<typeof acceptedDocumentSchema>;

/** Одна строка блока «Принятые документы»: что принято, когда, какой кнопкой и в какой редакции. */
export interface AcceptedDocumentItem {
  readonly key: string;
  readonly title: string;
  readonly acceptedAt: string;
  readonly buttonLabel: string | null;
  readonly edition: string;
  readonly href: Route | null;
  readonly shownTerms: string | null;
}

export type AcceptedDocumentsState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "ready"; items: readonly AcceptedDocumentItem[] }>;

const acceptedAtFormat = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function isLegalDocumentKey(value: string): value is LegalDocumentKey {
  return (legalDocumentKeys as readonly string[]).includes(value);
}

export function acceptedDocumentItems(
  documents: readonly AcceptedDocument[],
): readonly AcceptedDocumentItem[] {
  return documents.map((document) => {
    const version = Number(document.version);
    const known =
      isLegalDocumentKey(document.documentId) &&
      Number.isInteger(version) &&
      version > 0;
    return {
      key: document.acceptanceRef,
      title:
        legalNavigationEntry(document.documentId)?.navLabel ??
        document.documentId,
      acceptedAt: acceptedAtFormat.format(new Date(document.acceptedAt)),
      buttonLabel: document.buttonLabel,
      edition: `редакция ${document.version}`,
      href: known
        ? legalEditionPath(document.documentId as LegalDocumentKey, version)
        : null,
      shownTerms:
        document.shownTerms === null
          ? null
          : renewalTermsLine(document.shownTerms),
    };
  });
}
