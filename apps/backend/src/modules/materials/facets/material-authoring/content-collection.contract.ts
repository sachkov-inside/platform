export type ContentCollectionKind = "guide" | "series" | "topic";

/**
 * Author-written fields that tell a reader who a Guide is for, what they will be
 * able to do, what they must know beforehand, and what stays outside it. Field
 * names follow the Inside Content authoring `guide.yaml`, so an import carries
 * the authored text without translation. A Topic has no introduction.
 */
export interface GuideIntroductionDto {
  readonly audience: string;
  readonly outcome: string;
  readonly prerequisites: string;
  readonly scope: string;
}

export interface ContentCollectionDto {
  readonly archived: boolean;
  readonly id: string;
  readonly introduction: GuideIntroductionDto | null;
  readonly kind: ContentCollectionKind;
  readonly materialCount: number;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
  readonly version: number;
  readonly cover: ContentCoverProjection | null;
}
import type { ContentCoverProjection } from "../content-covers/content-covers.js";
