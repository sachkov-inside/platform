import type { MaterialAuthoring } from "../../../materials/index.js";
import type { AuthoringSearchGroup } from "../../ports/authoring-search-group.js";

/** The Products and Materials groups, in this order; Materials decides `materials:manage`. */
export function assembleMaterialsSearchGroups(
  authoring: Pick<MaterialAuthoring, "searchMaterials" | "searchProducts">,
): readonly AuthoringSearchGroup[] {
  return [
    {
      kind: "products",
      search: async (request) => {
        const result = await authoring.searchProducts(request);
        return result.ok
          ? {
              ok: true,
              value: {
                kind: "products",
                state: "ready",
                items: result.value.map((product) => ({
                  id: product.id,
                  name: product.name,
                  archived: product.archived,
                })),
              },
            }
          : result;
      },
    },
    {
      kind: "materials",
      search: async (request) => {
        const result = await authoring.searchMaterials(request);
        return result.ok
          ? {
              ok: true,
              value: {
                kind: "materials",
                state: "ready",
                items: result.value.map((material) => ({
                  id: material.id,
                  title: material.title,
                  publicationState: material.publicationState,
                  topic: material.topic,
                })),
              },
            }
          : result;
      },
    },
  ];
}
