import {
  attachMaterialVideoOperation,
  initMaterialVideoUploadOperation,
  reconcileMaterialVideoOperation,
  retryMaterialVideoDeletionOperation,
} from "./video-authoring.operation";

export type VideoMutationResult<Value> =
  | { readonly kind: "ready"; readonly value: Value }
  | { readonly kind: "unavailable" };

export type VideoUploadMutationResult = Awaited<
  ReturnType<typeof initMaterialVideoUpload>
>;

export const initMaterialVideoUpload = initMaterialVideoUploadOperation.send;

export const attachMaterialVideo = attachMaterialVideoOperation.send;

export const reconcileMaterialVideo = reconcileMaterialVideoOperation.send;

export const retryMaterialVideoDeletion =
  retryMaterialVideoDeletionOperation.send;
