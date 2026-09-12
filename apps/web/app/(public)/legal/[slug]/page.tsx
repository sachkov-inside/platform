import {
  currentLegalEdition,
  parseLegalText,
  supersededLegalEditions,
} from "@inside/legal";
import { legalDocumentKeys, type LegalDocumentKey } from "@inside/legal/document";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocumentPage } from "@/_pages/legal";

interface LegalDocumentRouteProps {
  readonly params: Promise<{ readonly slug: string }>;
}

function documentKey(slug: string): LegalDocumentKey | null {
  return legalDocumentKeys.find((key) => key === slug) ?? null;
}

export function generateStaticParams(): { readonly slug: string }[] {
  return legalDocumentKeys.map((key) => ({ slug: key }));
}

export async function generateMetadata({
  params,
}: LegalDocumentRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const key = documentKey(slug);
  if (key === null) return {};
  const edition = currentLegalEdition(key);
  return { title: edition.title, description: edition.summary };
}

/** Действующая редакция документа. */
export default async function LegalDocumentRoute({ params }: LegalDocumentRouteProps) {
  const { slug } = await params;
  const key = documentKey(slug);
  if (key === null) notFound();
  const edition = currentLegalEdition(key);
  return (
    <LegalDocumentPage
      blocks={parseLegalText(edition.text)}
      current={edition}
      edition={edition}
      superseded={supersededLegalEditions(key)}
    />
  );
}
