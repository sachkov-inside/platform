import type { MaterialDifficulty } from "../../domain/material-metadata.js";
import type { ContentCoverProjection } from "../content-covers/content-covers.js";

export interface PublishedMaterialProjectionDto {
  readonly materialId: string;
  readonly contentVersion: number;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  /** How hard the lesson is, and what the reader can do after it. Absent for a material
   * that promises neither. */
  readonly difficulty: MaterialDifficulty | null;
  readonly outcomes: readonly string[];
  readonly access: "free" | "membership" | "workshop";
  readonly publishedAt: string;
  readonly primaryVideoId: string | null;
  readonly cover: ContentCoverProjection | null;
  readonly topic: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly format: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly tags: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly seriesMemberships: readonly {
    readonly ordinal: number;
    readonly stepGroup?: string | null;
    readonly series: {
      readonly id: string;
      readonly name: string;
      readonly slug: string;
    };
  }[];
}
