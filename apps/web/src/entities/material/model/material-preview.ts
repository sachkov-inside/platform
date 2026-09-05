import type { ContentCover } from "./content-cover";

export interface MaterialPreview {
  readonly access: "free" | "membership" | "workshop";
  readonly availability: "available" | "locked" | "unavailable";
  readonly cover?: ContentCover | null | undefined;
  readonly format: string;
  readonly formatSlug?: string | undefined;
  readonly primaryVideoDurationSeconds?: number | undefined;
  readonly preview?: {
    readonly duration?: string;
    readonly label: string;
    readonly steps: readonly string[];
  };
  readonly seriesMemberships: readonly {
    readonly name: string;
    readonly ordinal: number;
    readonly slug: string;
  }[];
  readonly slug: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly title: string;
  readonly topic: string;
  readonly topicSlug: string;
}

export function materialPreviewHasVideo(material: MaterialPreview): boolean {
  return (
    material.formatSlug === "video" ||
    material.primaryVideoDurationSeconds !== undefined ||
    material.preview !== undefined
  );
}
