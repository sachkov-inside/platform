import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import type { GlossaryTermMark } from "../../domain/glossary-term-mark.js";
import type { GlossaryTerm } from "../../domain/glossary-term.js";

export type GlossaryDependencyError = {
  readonly code: "dependency_unavailable";
  readonly retryable: true;
};

export type GlossaryAuthoringError =
  | { readonly code: "forbidden" }
  | { readonly code: "invalid_glossary"; readonly message: string }
  | GlossaryDependencyError;

/** What one write changed among the listed terms. */
export interface GlossaryUpsert {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
}

/**
 * The Glossary: every Glossary Term of the platform, keyed by its permanent identifier. Authoring
 * writes the terms a content package carries; readers look terms up by the identifiers a Material
 * body mentions, at read time, so a corrected definition reaches every Material without a
 * republication.
 */
export interface Glossary {
  /** Creates or updates each listed term; a term missing from the list stays as it is. */
  upsert(command: {
    readonly actor: string;
    readonly terms: unknown;
  }): Promise<Result<GlossaryUpsert, GlossaryAuthoringError>>;
  /** The complete Glossary in identifier order, for an authoring client to compare against. */
  list(query: {
    readonly actor: string;
  }): Promise<Result<readonly GlossaryTerm[], GlossaryAuthoringError>>;
  /**
   * The known terms among `ids`, in the order asked; unknown identifiers are left out. The caller
   * owns access: it asks only for terms of a body it may already show.
   */
  lookup(
    ids: readonly string[],
  ): Promise<Result<readonly GlossaryTerm[], GlossaryDependencyError>>;
  /**
   * The terms whose introducing Material is among `sourceIds` (authoring source identifiers), in
   * identifier order. The caller owns access: it passes only Materials the reader may read.
   */
  introducedIn(
    sourceIds: readonly string[],
  ): Promise<Result<readonly GlossaryTerm[], GlossaryDependencyError>>;
  /** The reader's own marks among `termIds`, in the order asked; an unmarked term is absent. */
  readMarks(query: {
    readonly accountId: string;
    readonly termIds: readonly string[];
  }): Promise<Result<readonly GlossaryTermMark[], GlossaryMarkError>>;
  /** Sets the reader's mark on one known term; a newer mark replaces the older one. */
  setMark(command: {
    readonly accountId: string;
    readonly termId: string;
    readonly mark: string;
  }): Promise<Result<GlossaryTermMark, GlossaryMarkError>>;
}

export type GlossaryMarkError =
  | { readonly code: "invalid_request" }
  | { readonly code: "term_not_found" }
  | GlossaryDependencyError;

export const GLOSSARY: unique symbol = Symbol("GLOSSARY");
