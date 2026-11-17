export const legacyCatalogueScenario: {
  readonly product: {
    readonly name: string;
    readonly slug: string;
    readonly summary: string;
    readonly programmeSummary: string;
  };
  readonly offer: {
    readonly name: string;
    readonly withSupportName: string;
    readonly twoYearName: string;
  };
  readonly overview: { readonly slug: string; readonly title: string };
  readonly closedGuide: { readonly slug: string; readonly title: string };
  readonly illustrated: {
    readonly materialSummary: string;
    readonly primaryTopic: { readonly name: string; readonly slug: string };
  };
  readonly videos: {
    readonly pipeline: {
      readonly providerVideoId: string;
      readonly durationSeconds: number;
      readonly slug: string;
      readonly titleVariants: {
        readonly development: string;
        readonly illustrated: string;
      };
    };
    readonly deepModules: ScenarioVideoWithSlugVariants;
    readonly productContext: ScenarioVideoWithSlugVariants;
  };
};

interface ScenarioVideoWithSlugVariants {
  readonly providerVideoId: string;
  readonly durationSeconds: number;
  readonly title: string;
  readonly slugVariants: {
    readonly development: string;
    readonly illustrated: string;
  };
}
