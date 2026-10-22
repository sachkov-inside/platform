import {
  changeFunnelLifecycleOperation,
  listFunnelsOperation,
  previewFunnelOperation,
  publishFunnelOperation,
  readDeliveriesOperation,
  readFunnelOperation,
  readIntroOperation,
  resolveTemplateOperation,
  retryDeliveryOperation,
  saveFunnelOperation,
  saveIntroOperation,
  skipDeliveryOperation,
} from "./communications.operation";

export const listFunnels = listFunnelsOperation.send;
export const readFunnel = readFunnelOperation.send;
export const saveFunnel = saveFunnelOperation.send;
export const previewFunnel = previewFunnelOperation.send;
export const publishFunnel = publishFunnelOperation.send;
export const changeFunnelLifecycle = changeFunnelLifecycleOperation.send;
export const readIntro = readIntroOperation.send;
export const saveIntro = saveIntroOperation.send;
export const readDeliveries = readDeliveriesOperation.send;
export const skipDelivery = skipDeliveryOperation.send;
export const retryDelivery = retryDeliveryOperation.send;
export const resolveTemplate = resolveTemplateOperation.send;

export { readSavedPosts, savePost, samplePost } from "./broadcasts.browser";
