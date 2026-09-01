const russianMaterialTaxonomyLabels: Readonly<Record<string, string>> = {
  Guide: "Гайд",
  Platform: "Платформа",
};

export function materialTaxonomyLabel(value: string): string {
  return russianMaterialTaxonomyLabels[value] ?? value;
}
