import type { GuideArtifactResourceFactsAdapter } from "../../../content-access/index.js";
import type { GuideArtifacts } from "../../facets/guide-artifacts/guide-artifacts.js";

export function assembleGuideArtifactResourceFacts(
  artifacts: Pick<GuideArtifacts, "loadAccessFacts">,
): GuideArtifactResourceFactsAdapter {
  return {
    findMany: (artifactIds) => artifacts.loadAccessFacts(artifactIds),
    async findOne(artifactId) {
      const [row] = await artifacts.loadAccessFacts([artifactId]);
      return row ?? null;
    },
  };
}
