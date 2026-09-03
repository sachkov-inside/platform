import type { Metadata } from "next";

import { loadMaterialReader, MaterialReaderPage } from "@/_pages/material-reader.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";

interface MaterialPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{
    readonly from?: string | readonly string[] | undefined;
  }>;
}

export async function generateMetadata({
  params,
}: MaterialPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadMaterialReader(
    slug,
    await getOptionalPlatformAccessToken(),
  );
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

export default async function MaterialRoute({ params, searchParams }: MaterialPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const accessToken = await getOptionalPlatformAccessToken();
  return (
    <MaterialReaderPage
      {...(accessToken === undefined ? {} : { accessToken })}
      returnTarget={parseMaterialReaderReturnTarget(query.from)}
      slug={slug}
    />
  );
}
