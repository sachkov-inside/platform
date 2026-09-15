/**
 * Сколько людей сейчас держат действующее право на руководство: купили его или получили тариф, в
 * составе которого оно есть. Materials спрашивает об этом, прежде чем убрать опубликованный
 * материал из руководства: снять материал из купленного продукта можно только подтверждением.
 */
export interface GuideAccessHolders {
  countGuideHolders(guideIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
}
