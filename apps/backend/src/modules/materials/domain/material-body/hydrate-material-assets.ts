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
  switch (block.kind) {
    case "image": {
      const asset = byId.get(block.assetId);
      return asset?.kind === "image"
        ? { ...block, height: asset.height, variants: asset.variants, width: asset.width }
        : block;
    }
    case "file": {
      const asset = byId.get(block.assetId);
      return asset?.kind === "file"
        ? { ...block, contentType: asset.contentType, filename: asset.filename, size: asset.size }
        : block;
    }
    case "blockquote":
    case "callout":
      return { ...block, content: block.content.map((child) => hydrateBlock(child, byId)) };
    case "bullet_list":
    case "ordered_list":
      return { ...block, items: block.items.map((item) => item.map((child) => hydrateBlock(child, byId))) };
    case "table":
      return {
        ...block,
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({
            ...cell,
            content: cell.content.map((child) => hydrateBlock(child, byId)),
          })),
        })),
      };
    case "code_block":
    case "heading":
    case "horizontal_rule":
    case "paragraph":
    case "video":
      return block;
  }
}
