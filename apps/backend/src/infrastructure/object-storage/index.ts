export {
  assertPresignedGetTtl,
  type ObjectStorage,
  type ObjectStorageNamespace,
  type PutImmutableObjectResult,
  type StoredObject,
} from "./object-storage.js";
export {
  createS3ObjectStorage,
  ensureS3Buckets,
  type S3ObjectStorageConfig,
} from "./s3-object-storage.js";
export {
  OBJECT_STORAGE,
  ObjectStorageModule,
} from "./object-storage.module.js";
