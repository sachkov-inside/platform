export function materialAssetFileHref({
  materialId,
  assetId,
  contentVersion,
  preview = false,
}: {
  readonly materialId: string;
  readonly assetId: string;
  readonly contentVersion: number;
  readonly preview?: boolean;
}): string {
  const query = new URLSearchParams({ contentVersion: String(contentVersion) });
  if (preview) query.set("preview", "true");
  return `/api/materials/${encodeURIComponent(materialId)}/assets/${encodeURIComponent(assetId)}?${query.toString()}`;
}
