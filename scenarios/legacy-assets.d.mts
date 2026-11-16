interface LegacyAssetFacts {
  readonly key: string;
  readonly nodeId: string;
  readonly legacyAssetId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly text: string;
}
export const legacyAssetsScenario: {
  readonly slug: string;
  readonly assets: readonly [
    LegacyAssetFacts & {
      readonly kind: "image";
      readonly alt: string;
      readonly caption: string;
    },
    LegacyAssetFacts & { readonly kind: "file"; readonly label: string },
  ];
};
