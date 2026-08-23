import type { MaterialBody } from "./material-body/material-body.js";
import type { MaterialRevisionMetadata } from "./material-revision-metadata.js";
import type {
  MaterialId,
  MaterialRevisionId,
} from "./material-identifiers.js";
import type { Result } from "../result.js";

export interface MaterialRevision {
  readonly id: MaterialRevisionId;
  readonly materialId: MaterialId;
  readonly restoredFromRevisionId?: MaterialRevisionId;
  readonly metadata: MaterialRevisionMetadata;
  readonly body: MaterialBody;
}

export function materialRevision(
  values: MaterialRevision,
): MaterialRevision {
  return Object.freeze({ ...values });
}

export function restoreMaterialRevision(
  source: MaterialRevision,
  revisionId: MaterialRevisionId,
): MaterialRevision {
  return materialRevision({
    id: revisionId,
    materialId: source.materialId,
    restoredFromRevisionId: source.id,
    metadata: source.metadata,
    body: source.body,
  });
}

export interface StaleRevisionError {
  readonly code: "stale_revision";
  readonly currentRevisionId: MaterialRevisionId;
}

export interface StalePublicationError {
  readonly code: "stale_publication";
  readonly currentPublishedRevisionId: MaterialRevisionId | null;
}

export interface MaterialValues {
  readonly id: MaterialId;
  readonly currentDraftRevisionId: MaterialRevisionId;
  readonly currentPublishedRevisionId: MaterialRevisionId | null;
}

export class Material {
  readonly id: MaterialId;
  readonly currentDraftRevisionId: MaterialRevisionId;
  readonly currentPublishedRevisionId: MaterialRevisionId | null;

  private constructor(values: MaterialValues) {
    this.id = values.id;
    this.currentDraftRevisionId = values.currentDraftRevisionId;
    this.currentPublishedRevisionId = values.currentPublishedRevisionId;
    Object.freeze(this);
  }

  static restore(values: MaterialValues): Material {
    return new Material(values);
  }

  advanceDraft(
    baseRevisionId: MaterialRevisionId,
    revisionId: MaterialRevisionId,
  ): Result<Material, StaleRevisionError> {
    if (this.currentDraftRevisionId !== baseRevisionId) {
      return {
        ok: false,
        error: {
          code: "stale_revision",
          currentRevisionId: this.currentDraftRevisionId,
        },
      };
    }
    return {
      ok: true,
      value: new Material({
        id: this.id,
        currentDraftRevisionId: revisionId,
        currentPublishedRevisionId: this.currentPublishedRevisionId,
      }),
    };
  }

  publishRevision(
    revisionId: MaterialRevisionId,
    expectedPublishedRevisionId: MaterialRevisionId | null,
  ): Result<Material, StaleRevisionError | StalePublicationError> {
    if (this.currentDraftRevisionId !== revisionId) {
      return {
        ok: false,
        error: {
          code: "stale_revision",
          currentRevisionId: this.currentDraftRevisionId,
        },
      };
    }
    if (this.currentPublishedRevisionId !== expectedPublishedRevisionId) {
      return {
        ok: false,
        error: {
          code: "stale_publication",
          currentPublishedRevisionId: this.currentPublishedRevisionId,
        },
      };
    }
    return {
      ok: true,
      value: new Material({
        id: this.id,
        currentDraftRevisionId: this.currentDraftRevisionId,
        currentPublishedRevisionId: revisionId,
      }),
    };
  }

  unpublish(
    expectedPublishedRevisionId: MaterialRevisionId,
  ): Result<Material, StalePublicationError> {
    if (this.currentPublishedRevisionId !== expectedPublishedRevisionId) {
      return {
        ok: false,
        error: {
          code: "stale_publication",
          currentPublishedRevisionId: this.currentPublishedRevisionId,
        },
      };
    }
    return {
      ok: true,
      value: new Material({
        id: this.id,
        currentDraftRevisionId: this.currentDraftRevisionId,
        currentPublishedRevisionId: null,
      }),
    };
  }
}
