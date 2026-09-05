export type ContentCollectionKind = "series" | "topic";

export interface ContentCollectionDto {
  readonly archived: boolean;
  readonly id: string;
  readonly kind: ContentCollectionKind;
  readonly materialCount: number;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
  readonly version: number;
  readonly cover: ContentCoverProjection | null;
}
import type { ContentCoverProjection } from "../content-covers/content-covers.js";
