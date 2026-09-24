import { legalDocumentKeys } from "@inside/legal/document";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocumentPage } from "@/_pages/legal";
import { legalDocumentView } from "@/_pages/legal.server";

/** Страница пока не разложена на слои: проверка мгновенности с неё снята (ADR 0027). */
export const instant = false;

interface LegalDocumentRouteProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export function generateStaticParams(): { readonly slug: string }[] {
  return legalDocumentKeys.map((key) => ({ slug: key }));
}

export async function generateMetadata({
  params,
}: LegalDocumentRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const view = legalDocumentView(slug);
  return view === null
    ? {}
    : { title: view.edition.title, description: view.edition.summary };
}

/** Действующая редакция документа. */
export default async function LegalDocumentRoute({ params }: LegalDocumentRouteProps) {
  const { slug } = await params;
  const view = legalDocumentView(slug);
  if (view === null) notFound();
  return <LegalDocumentPage {...view} />;
}
