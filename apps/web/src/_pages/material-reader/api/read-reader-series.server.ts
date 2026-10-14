import "server-only";
import { loadPublishedSeries, readPublicSeries } from "@/features/library-discovery.server";
import type { PublishedSeriesResult } from "@/features/library-discovery";

/** Guests use shared programme composition; signed-in readers keep their private read. */
export function readReaderSeries(slug: string, accessToken?: string): Promise<PublishedSeriesResult> {
  return accessToken === undefined ? readPublicSeries(slug) : loadPublishedSeries(slug, accessToken);
}
