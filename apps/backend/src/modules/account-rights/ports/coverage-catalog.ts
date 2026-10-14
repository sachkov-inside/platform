import type { coverageEntrySchema } from "@inside/access-capabilities";
import type { z } from "zod";

type CoverageEntry = z.infer<typeof coverageEntrySchema>;

export const COVERAGE_CATALOG_ENTRY_LIMIT = 2000;
export const COVERAGE_CATALOG_SCOPE_LIMIT = 1000;

/**
 * Titles and availability of the Products and Materials an access scope names. Metadata only:
 * knowing a title never authorizes a body. Materials implements it under `COVERAGE_CATALOG`.
 */
export interface CoverageCatalog {
  list(): Promise<CoverageEntry[]>;
  resolve(scope: unknown): Promise<CoverageEntry[]>;
  /** At most 1000 scopes and 2000 distinct entries; overflow fails explicitly. */
  resolveMany(scopes: readonly unknown[]): Promise<CoverageEntry[][]>;
}

export const COVERAGE_CATALOG = Symbol("COVERAGE_CATALOG");
