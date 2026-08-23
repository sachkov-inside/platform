import type { MaterialBody } from "./material-body/material-body.js";
import type { MaterialRevisionMetadata } from "./material-revision-metadata.js";
import type {
  MaterialId,
  MaterialRevisionId,
} from "./material-identifiers.js";

export interface MaterialRevisionValues {
  readonly id: MaterialRevisionId;
  readonly materialId: MaterialId;
  readonly restoredFromRevisionId?: MaterialRevisionId;
  readonly metadata: MaterialRevisionMetadata;
  readonly body: MaterialBody;
}

export class MaterialRevision {
  readonly id: MaterialRevisionId;
  readonly materialId: MaterialId;
  readonly restoredFromRevisionId: MaterialRevisionId | undefined;
  readonly metadata: MaterialRevisionMetadata;
  readonly body: MaterialBody;

  private constructor(values: MaterialRevisionValues) {
    if (values.id.length === 0 || values.materialId.length === 0) {
      throw new TypeError("A MaterialRevision must identify its Material and revision");
    }
    this.id = values.id;
    this.materialId = values.materialId;
    this.restoredFromRevisionId = values.restoredFromRevisionId;
    this.metadata = values.metadata;
    this.body = values.body;
    Object.freeze(this);
  }

  static restore(values: MaterialRevisionValues): MaterialRevision {
    return new MaterialRevision(values);
  }

  restoreAs(revisionId: MaterialRevisionId): MaterialRevision {
    return new MaterialRevision({
      id: revisionId,
      materialId: this.materialId,
      restoredFromRevisionId: this.id,
      metadata: this.metadata,
      body: this.body,
    });
  }
}

export type MaterialLifecycleError =
  | {
      readonly code: "stale_revision";
      readonly currentRevisionId: MaterialRevisionId;
    }
  | {
      readonly code: "stale_publication";
      readonly currentPublishedRevisionId: MaterialRevisionId | null;
    };

export type MaterialLifecycleResult =
  | { readonly ok: true; readonly value: Material }
  | { readonly ok: false; readonly error: MaterialLifecycleError };

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
    if (values.id.length === 0 || values.currentDraftRevisionId.length === 0) {
      throw new TypeError("A Material must identify its current draft revision");
    }
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
  ): MaterialLifecycleResult {
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
  ): MaterialLifecycleResult {
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

  unpublish(expectedPublishedRevisionId: MaterialRevisionId): MaterialLifecycleResult {
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
