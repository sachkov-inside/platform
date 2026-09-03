export interface WorkshopMaterialCatalog {
  findMany(materialIds: readonly string[]): Promise<readonly WorkshopMaterialFacts[]>;
}

export interface WorkshopMaterialFacts {
  readonly materialId: string;
  readonly access: "free" | "membership" | "workshop";
  readonly publicationState: "draft" | "published" | "unpublished";
}
