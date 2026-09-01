import type { LoadMaterialOperation } from "../load-material/load-material.contract.js";
import type { SaveMaterialOperation } from "../save-material/save-material.contract.js";
import type { TransitionMaterialPublicationOperation } from "./transition-material-publication.contract.js";

export function assembleTransitionMaterialPublication(dependencies: {
  readonly loadMaterial: LoadMaterialOperation;
  readonly saveMaterial: SaveMaterialOperation;
}): TransitionMaterialPublicationOperation {
  return async (command) => {
    const current = await dependencies.loadMaterial({
      actor: command.actor,
      materialId: command.materialId,
    });
    if (!current.ok) {
      return current;
    }

    return dependencies.saveMaterial({
      actor: command.actor,
      body: current.value.body,
      expectedContentVersion: command.expectedContentVersion,
      idempotencyKey: command.idempotencyKey,
      materialId: command.materialId,
      metadata: {
        access: current.value.metadata.access,
        formatId: current.value.metadata.formatId,
        seriesIds: current.value.metadata.seriesMemberships.map(
          ({ seriesId }) => seriesId,
        ),
        summary: current.value.metadata.summary,
        tagIds: current.value.metadata.tagIds,
        title: current.value.metadata.title,
        topicId: current.value.metadata.topicId,
      },
      publicationState: command.publicationState,
    });
  };
}
