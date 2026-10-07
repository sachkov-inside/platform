const russianMaterialTaxonomyLabels: Readonly<Record<string, string>> = {
  Product: "Гайд",
  Platform: "Платформа",
};

export function materialTaxonomyLabel(value: string): string {
  return russianMaterialTaxonomyLabels[value] ?? value;
}
