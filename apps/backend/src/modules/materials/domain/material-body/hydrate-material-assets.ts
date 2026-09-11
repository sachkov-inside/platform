import { mapMaterialBlockChildren } from "@inside/material-blocks";

import type { MaterialAssetPresentation } from "../../../assets/index.js";
import type { RenderedBlock, RenderedMaterialBody } from "./material-body.js";

export function hydrateMaterialAssets(
  body: RenderedMaterialBody,
  presentations: readonly MaterialAssetPresentation[],
): RenderedMaterialBody {
  const byId = new Map(presentations.map((asset) => [asset.assetId, asset]));
  return {
    ...body,
    blocks: body.blocks.map((block) => hydrateBlock(block, byId)),
  };
}

function hydrateBlock(
  block: RenderedBlock,
  byId: ReadonlyMap<string, MaterialAssetPresentation>,
): RenderedBlock {
  const hydrated = mapMaterialBlockChildren(block, (child) =>
    hydrateBlock(child, byId),
  );
  // Only asset blocks carry presentation the registry cannot know; every other block is
  // already complete once its nested blocks are hydrated.
  if (hydrated.kind === "image") {
    const asset = byId.get(hydrated.assetId);
    return asset?.kind === "image"
      ? { ...hydrated, height: asset.height, variants: asset.variants, width: asset.width }
      : hydrated;
  }
  if (hydrated.kind === "file") {
    const asset = byId.get(hydrated.assetId);
    return asset?.kind === "file"
      ? { ...hydrated, contentType: asset.contentType, filename: asset.filename, size: asset.size }
      : hydrated;
  }
  return hydrated;
}
