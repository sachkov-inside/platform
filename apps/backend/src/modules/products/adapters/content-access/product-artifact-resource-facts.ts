import type { ProductArtifactResourceFactsAdapter } from "../../../content-access/index.js";
import type { ProductArtifacts } from "../../facets/product-artifacts/product-artifacts.js";

export function assembleProductArtifactResourceFacts(
  artifacts: Pick<ProductArtifacts, "loadAccessFacts">,
): ProductArtifactResourceFactsAdapter {
  return {
    findMany: (artifactIds) => artifacts.loadAccessFacts(artifactIds),
    async findOne(artifactId) {
      const [row] = await artifacts.loadAccessFacts([artifactId]);
      return row ?? null;
    },
  };
}
