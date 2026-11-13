import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import type { GlossaryTerm } from "../../domain/glossary-term.js";

export type GlossaryDependencyError = {
  readonly code: "dependency_unavailable";
  readonly retryable: true;
};

export type GlossaryAuthoringError =
  | { readonly code: "forbidden" }
  | { readonly code: "invalid_glossary"; readonly message: string }
  | GlossaryDependencyError;

/** What one replacement changed, counted by term. */
export interface GlossaryReplacement {
  readonly created: number;
  readonly updated: number;
  readonly removed: number;
  readonly unchanged: number;
}

/**
 * The Glossary: every Glossary Term of the platform, keyed by its permanent identifier. Authoring
 * replaces it whole from the content package; readers look terms up by the identifiers a Material
 * body mentions, at read time, so a corrected definition reaches every Material without a
 * republication.
 */
export interface Glossary {
  /** Makes the given list the complete Glossary: absent terms are removed. */
  replace(command: {
    readonly actor: string;
    readonly terms: unknown;
  }): Promise<Result<GlossaryReplacement, GlossaryAuthoringError>>;
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
}

export const GLOSSARY: unique symbol = Symbol("GLOSSARY");
