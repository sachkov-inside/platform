import type { Metadata } from "next";

import { getMaterialReader, MaterialReaderPage } from "@/_pages/material-reader.server";

export async function generateMetadata({
  params,
}: PageProps<"/materials/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const result = await getMaterialReader(slug);
  if (result.kind === "not-found") {
    return { title: "Материал не найден" };
  }
  if (result.kind === "unavailable") {
    return { title: "Материал временно недоступен" };
  }
  return {
    title: result.material.title,
    description: result.material.summary,
  };
}

export default async function Page({ params }: PageProps<"/materials/[slug]">) {
  const { slug } = await params;
  return <MaterialReaderPage slug={slug} />;
}
