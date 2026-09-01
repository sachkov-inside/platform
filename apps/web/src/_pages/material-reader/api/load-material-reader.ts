import "server-only";

import { cache } from "react";

import { getMaterialReader } from "./get-material-reader";

/** Deduplicates metadata and page reads inside one Next.js render request. */
export const loadMaterialReader = cache(
  (slug: string, accessToken?: string) => getMaterialReader(slug, accessToken),
);
