import type { MaterialId } from "./material-identifiers.js";
import type { Result } from "../result.js";

export type PublicationState = "draft" | "published" | "unpublished";

export interface MaterialValues {
  readonly id: MaterialId;
  readonly slug: string | null;
  readonly publicationState: PublicationState;
  readonly contentVersion: number;
  readonly firstPublishedAt: Date | null;
  readonly publishedAt: Date | null;
}

export interface MaterialSaveTransition {
  readonly expectedContentVersion: number;
  readonly publicationState: PublicationState;
  readonly slug: string | null;
  readonly now: Date;
}

export type MaterialSaveError =
  | {
      readonly code: "stale_content_version";
      readonly currentContentVersion: number;
    }
  | {
      readonly code: "invalid_publication_transition";
      readonly currentState: PublicationState;
      readonly targetState: PublicationState;
    };

export class Material {
  readonly id: MaterialId;
  readonly slug: string | null;
  readonly publicationState: PublicationState;
  readonly contentVersion: number;
  readonly firstPublishedAt: Date | null;
  readonly publishedAt: Date | null;

  private constructor(values: MaterialValues) {
    this.id = values.id;
    this.slug = values.slug;
    this.publicationState = values.publicationState;
    this.contentVersion = values.contentVersion;
    this.firstPublishedAt = values.firstPublishedAt;
    this.publishedAt = values.publishedAt;
    Object.freeze(this);
  }

  static restore(values: MaterialValues): Material {
    return new Material(values);
  }

  canDelete(): boolean {
    return this.publicationState === "draft" && this.firstPublishedAt === null;
  }

  save(
    transition: MaterialSaveTransition,
  ): Result<Material, MaterialSaveError> {
    if (transition.expectedContentVersion !== this.contentVersion) {
      return {
        ok: false,
        error: {
          code: "stale_content_version",
          currentContentVersion: this.contentVersion,
        },
      };
    }
    if (!canTransition(this.publicationState, transition.publicationState)) {
      return {
        ok: false,
        error: {
          code: "invalid_publication_transition",
          currentState: this.publicationState,
          targetState: transition.publicationState,
        },
      };
    }

    const entersPublished =
      transition.publicationState === "published" &&
      this.publicationState !== "published";
    return {
      ok: true,
      value: new Material({
        id: this.id,
        slug: this.slug ?? transition.slug,
        publicationState: transition.publicationState,
        contentVersion: this.contentVersion + 1,
        firstPublishedAt:
          this.firstPublishedAt ?? (entersPublished ? transition.now : null),
        publishedAt: entersPublished ? transition.now : this.publishedAt,
      }),
    };
  }
}

function canTransition(
  current: PublicationState,
  target: PublicationState,
): boolean {
  return current === "draft"
    ? target === "draft" || target === "published"
    : target === "published" || target === "unpublished";
}
