export interface PublishedMaterialProjectionDto {
  readonly materialId: string;
  readonly contentVersion: number;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly access: "free" | "membership";
  readonly publishedAt: string;
  readonly primaryVideoId: string | null;
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
    readonly series: {
      readonly id: string;
      readonly name: string;
      readonly slug: string;
    };
  }[];
}
