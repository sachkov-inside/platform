export interface MaterialPreview {
  readonly access: "free" | "membership";
  readonly availability: "available" | "locked" | "unavailable";
  readonly format: string;
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
