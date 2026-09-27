import type { Subject } from "../../../content-access/index.js";
import type { PracticeDefinition } from "../../domain/practice-definition.js";
import type { SystemError } from "../../facets/material-authoring/material-authoring.contract.js";
import type { Result } from "../../result.js";

export interface PublishedPractice {
  readonly practiceId: string;
  readonly practiceVersion: number;
  readonly definitionDigest: string;
  readonly definition: PracticeDefinition;
  readonly materialId: string;
  readonly materialSlug: string;
  readonly materialContentVersion: number;
  readonly sourceReference: {
    readonly materialSourceId: string;
    readonly materialSourceRevision: string;
  };
  readonly provenance: {
    readonly repository: string;
    readonly commit: string;
    readonly path: string;
  };
}
export type PublishedPracticeError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "practice_not_available" }
  | {
      readonly code: "practice_context_unavailable";
      readonly reason: "source_changed";
    }
  | { readonly code: "practice_context_changed" }
  | SystemError;
export interface ReadPublishedPracticeQuery {
  readonly subject: Subject;
  readonly practiceId: string;
  readonly expectedPracticeVersion?: number;
  readonly expectedContentVersion?: number;
}
export type ReadPublishedPracticeOperation = (
  query: ReadPublishedPracticeQuery,
) => Promise<Result<PublishedPractice, PublishedPracticeError>>;
export type ListPublishedPracticesOperation = (query: {
  readonly subject: Subject;
  readonly materialSlug: string;
}) => Promise<Result<readonly PublishedPractice[], PublishedPracticeError>>;
