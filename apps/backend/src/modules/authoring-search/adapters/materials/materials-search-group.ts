import type { MaterialAuthoring } from "../../../materials/index.js";
import type { AuthoringSearchGroup } from "../../ports/authoring-search-group.js";

/** The Materials group; Materials decides `materials:manage`. */
export function assembleMaterialsSearchGroup(
  authoring: Pick<MaterialAuthoring, "searchMaterials">,
): AuthoringSearchGroup {
  return {
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
  };
}
