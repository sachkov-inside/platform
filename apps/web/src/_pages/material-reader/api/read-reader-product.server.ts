import "server-only";
import {
  loadPublishedProduct,
  readPublicProduct,
} from "@/features/library-discovery.server";
import type { PublishedProductResult } from "@/features/library-discovery";

/** Guests use shared programme composition; signed-in readers keep their private read. */
export function readReaderProduct(
  slug: string,
  accessToken?: string,
): Promise<PublishedProductResult> {
  return accessToken === undefined
    ? readPublicProduct(slug)
    : loadPublishedProduct(slug, accessToken);
}
