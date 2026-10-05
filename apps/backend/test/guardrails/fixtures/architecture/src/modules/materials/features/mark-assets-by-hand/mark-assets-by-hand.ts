// Materials may hand its transaction to Assets, but must not write Asset rows itself.
export async function markAssetsByHand(transaction: {
  materialAsset: { updateMany(input: unknown): Promise<unknown> };
}): Promise<void> {
  await transaction.materialAsset.updateMany({ data: { currentlyReferenced: false } });
}
