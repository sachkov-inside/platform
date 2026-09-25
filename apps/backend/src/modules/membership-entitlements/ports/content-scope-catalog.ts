import type { contentScopeEntrySchema } from "@inside/access-capabilities";
import type { z } from "zod";

type ContentScopeEntry = z.infer<typeof contentScopeEntrySchema>;

/**
 * Titles and availability of the Guides and Materials an access scope names. Metadata only:
 * knowing a title never authorizes a body. Materials implements it under `CONTENT_SCOPE_CATALOG`.
 */
export interface ContentScopeCatalog {
  list(): Promise<ContentScopeEntry[]>;
  resolve(scope: unknown): Promise<ContentScopeEntry[]>;
}

export const CONTENT_SCOPE_CATALOG = Symbol("CONTENT_SCOPE_CATALOG");
