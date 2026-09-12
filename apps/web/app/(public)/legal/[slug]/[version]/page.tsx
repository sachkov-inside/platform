import {
  currentLegalEdition,
  findLegalEdition,
  legalEditions,
  parseLegalText,
  supersededLegalEditions,
} from "@inside/legal";
import { legalDocumentKeys, legalEditionVersion } from "@inside/legal/document";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocumentPage } from "@/_pages/legal";
import { legalDocumentPath } from "@/shared/routing/public-page-path";

interface LegalEditionRouteProps {
  readonly params: Promise<{ readonly slug: string; readonly version: string }>;
}

function requestedEdition(slug: string, version: string) {
  const key = legalDocumentKeys.find((candidate) => candidate === slug);
  const number = legalEditionVersion(version);
  if (key === undefined || number === undefined) return null;
  const edition = findLegalEdition(key, number);
  return edition === undefined ? null : { edition, key };
}

export function generateStaticParams(): {
  readonly slug: string;
  readonly version: string;
}[] {
  return legalEditions.map((edition) => ({
    slug: edition.key,
    version: `v${String(edition.version)}`,
  }));
}

/**
 * Адрес редакции неизменяем: по нему читают текст, который принимали. Поиску он не нужен —
 * каноническим остаётся адрес документа, а редакция повторяет его содержимое.
 */
export async function generateMetadata({
  params,
}: LegalEditionRouteProps): Promise<Metadata> {
  const { slug, version } = await params;
  const requested = requestedEdition(slug, version);
  if (requested === null) return {};
  return {
    alternates: { canonical: legalDocumentPath(requested.key) },
    description: requested.edition.summary,
    robots: { follow: true, index: false },
    title: `${requested.edition.title}: редакция ${String(requested.edition.version)}`,
  };
}

/** Названная редакция документа: текст, который читали и принимали в своё время. */
export default async function LegalEditionRoute({ params }: LegalEditionRouteProps) {
  const { slug, version } = await params;
  const requested = requestedEdition(slug, version);
  if (requested === null) notFound();
  return (
    <LegalDocumentPage
      blocks={parseLegalText(requested.edition.text)}
      current={currentLegalEdition(requested.key)}
      edition={requested.edition}
      superseded={supersededLegalEditions(requested.key)}
    />
  );
}
