import type { Metadata } from "next";

import { GuideProgrammePage } from "@/_pages/library-discovery.server";
import { loadPublishedSeries } from "@/features/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

interface GuideProgrammeRouteProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export async function generateMetadata({
  params,
}: GuideProgrammeRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadPublishedSeries(
    slug,
    await getOptionalPlatformAccessToken(),
  );
  return result.kind === "ready" || result.kind === "empty"
    ? {
        title: `Программа · ${result.reference.name}`,
        description: `Материалы продукта «${result.reference.name}» по главам в авторском порядке.`,
      }
    : {
        title:
          result.kind === "not-found"
            ? "Продукт не найден"
            : "Продукт недоступен",
      };
}

export default async function GuideProgrammeRoute({
  params,
}: GuideProgrammeRouteProps) {
  const { slug } = await params;
  const accessToken = await getOptionalPlatformAccessToken();
  return (
    <GuideProgrammePage
      {...(accessToken === undefined ? {} : { accessToken })}
      slug={slug}
    />
  );
}
