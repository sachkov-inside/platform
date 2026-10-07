import type { coverageEntrySchema } from "@inside/access-capabilities";
import type { z } from "zod";

type CoverageEntry = z.infer<typeof coverageEntrySchema>;

/**
 * Titles and availability of the Products and Materials an access scope names. Metadata only:
 * knowing a title never authorizes a body. Materials implements it under `COVERAGE_CATALOG`.
 */
export interface CoverageCatalog {
  list(): Promise<CoverageEntry[]>;
  resolve(scope: unknown): Promise<CoverageEntry[]>;
}

export const COVERAGE_CATALOG = Symbol("COVERAGE_CATALOG");
