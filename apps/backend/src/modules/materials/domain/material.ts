import type { ValidationIssue } from "./material-document/material-document.js";

export interface SeriesMembershipInput {
  readonly seriesId: string;
  readonly ordinal: number;
}

export interface DraftMetadata {
  readonly title: string;
  readonly summary: string;
  readonly slug: string;
  readonly topicId: string;
  readonly formatId: string;
  readonly tagIds: readonly string[];
  readonly seriesMemberships: readonly SeriesMembershipInput[];
}

export interface DraftMetadataChanges {
  readonly title?: string;
  readonly summary?: string;
  readonly slug?: string;
  readonly topicId?: string;
  readonly formatId?: string;
  readonly tagIds?: readonly string[];
  readonly seriesMemberships?: readonly SeriesMembershipInput[];
}

export type MaterialMetadataValidationError =
  | {
      readonly code: "invalid_content";
      readonly issues: readonly ValidationIssue[];
    }
  | { readonly code: "duplicate_tag"; readonly tagId: string };
