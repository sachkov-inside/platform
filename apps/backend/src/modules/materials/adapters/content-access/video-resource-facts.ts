import type { VideoResourceFactsAdapter } from "../../../content-access/index.js";
import type { Videos } from "../../../videos/index.js";
import { materialId } from "../../domain/material-identifiers.js";

export function assembleVideoResourceFacts(
  videos: Pick<Videos, "loadAccessFacts">,
): VideoResourceFactsAdapter {
  return {
    async findMany(videoIds) {
      const result = await videos.loadAccessFacts(videoIds);
      if (!result.ok) throw new Error(result.error.code);
      return result.value.map((facts) => ({
        ...facts,
        materialId: materialId(facts.materialId),
      }));
    },
    async findOne(videoId) {
      const result = await videos.loadAccessFacts([videoId]);
      if (!result.ok) throw new Error(result.error.code);
      const facts = result.value[0];
      return facts === undefined
        ? null
        : { ...facts, materialId: materialId(facts.materialId) };
    },
  };
}
