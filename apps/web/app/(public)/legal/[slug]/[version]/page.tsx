import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocumentPage } from "@/_pages/legal";
import { legalDocumentView, legalEditionParams } from "@/_pages/legal.server";
import { legalDocumentPath } from "@/shared/routing/public-page-path";

interface LegalEditionRouteProps {
  readonly params: Promise<{ readonly slug: string; readonly version: string }>;
}

export function generateStaticParams(): {
  readonly slug: string;
  readonly version: string;
}[] {
  return legalEditionParams();
}

/**
 * Адрес редакции неизменяем: по нему читают текст, который принимали. Поиску он не нужен —
 * каноническим остаётся адрес документа, а редакция повторяет его содержимое.
 */
export async function generateMetadata({
  params,
}: LegalEditionRouteProps): Promise<Metadata> {
  const { slug, version } = await params;
  const view = legalDocumentView(slug, version);
  if (view === null) return {};
  return {
    alternates: { canonical: legalDocumentPath(view.edition.key) },
    description: view.edition.summary,
    robots: { follow: true, index: false },
    title: `${view.edition.title}: редакция ${String(view.edition.version)}`,
  };
}

/** Названная редакция документа: текст, который читали и принимали в своё время. */
export default async function LegalEditionRoute({ params }: LegalEditionRouteProps) {
  const { slug, version } = await params;
  const view = legalDocumentView(slug, version);
  if (view === null) notFound();
  return <LegalDocumentPage {...view} />;
}
