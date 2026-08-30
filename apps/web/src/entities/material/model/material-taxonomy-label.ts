const russianMaterialTaxonomyLabels: Readonly<Record<string, string>> = {
  Guide: "Руководство",
  Platform: "Платформа",
};

export function materialTaxonomyLabel(value: string): string {
  return russianMaterialTaxonomyLabels[value] ?? value;
}
