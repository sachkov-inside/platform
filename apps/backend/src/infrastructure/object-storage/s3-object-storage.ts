import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  assertPresignedGetTtl,
  type ObjectStorage,
  type ObjectStorageNamespace,
} from "./object-storage.js";

export interface S3ObjectStorageConfig {
  readonly buckets: Readonly<Record<ObjectStorageNamespace, string>>;
  readonly credentials: Readonly<{
    accessKeyId: string;
    secretAccessKey: string;
  }>;
  readonly endpoint: string;
  readonly forcePathStyle: boolean;
  readonly region: string;
}

type SignGet = (
  client: S3Client,
  command: GetObjectCommand,
  options: { readonly expiresIn: number },
) => Promise<string>;
type ObjectCommand = DeleteObjectCommand | GetObjectCommand | PutObjectCommand;
type SendObjectCommand = (command: ObjectCommand) => Promise<unknown>;

export function createS3ObjectStorage(
  config: S3ObjectStorageConfig,
  overrides: {
    readonly send?: SendObjectCommand;
    readonly sign?: SignGet;
  } = {},
): ObjectStorage {
  const client = new S3Client({
    credentials: config.credentials,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
  });
  const send: SendObjectCommand = overrides.send ?? ((command) => client.send(command));
  const sign = overrides.sign ?? getSignedUrl;

  const storage: ObjectStorage = {
    async putImmutable(input) {
      assertObjectKey(input.key);
      try {
        await send(
          new PutObjectCommand({
            Body: input.body,
            Bucket: config.buckets[input.namespace],
            ContentType: input.contentType,
            IfNoneMatch: "*",
            Key: input.key,
            Metadata: { sha256: input.checksumSha256 },
          }),
        );
        return { ok: true };
      } catch (error) {
        if (isOverwriteRefusal(error)) {
          return {
            error: { code: "object_already_exists" },
            ok: false,
          };
        }
        throw error;
      }
    },

    async read(namespace, key) {
      assertObjectKey(key);
      try {
        const response = await send(
          new GetObjectCommand({ Bucket: config.buckets[namespace], Key: key }),
        );
        if (!isStoredObjectResponse(response)) {
          throw new TypeError("Stored object metadata is incomplete");
        }
        return {
          body: await response.Body.transformToByteArray(),
          checksumSha256: response.Metadata.sha256,
          contentLength: response.ContentLength,
          contentType: response.ContentType,
        };
      } catch (error) {
        if (isMissingObject(error)) {
          return null;
        }
        throw error;
      }
    },

    async delete(namespace, key) {
      assertObjectKey(key);
      await send(
        new DeleteObjectCommand({ Bucket: config.buckets[namespace], Key: key }),
      );
    },

    async signGet(input) {
      assertPresignedGetTtl(input.ttlSeconds);
      assertObjectKey(input.key);
      if (input.namespace !== "protected") {
        throw new TypeError("Only protected objects use signed GET credentials");
      }
      return sign(
        client,
        new GetObjectCommand({
          Bucket: config.buckets[input.namespace],
          Key: input.key,
          ...(input.contentDisposition === undefined
            ? {}
            : { ResponseContentDisposition: input.contentDisposition }),
          ...(input.contentType === undefined
            ? {}
            : { ResponseContentType: input.contentType }),
        }),
        { expiresIn: input.ttlSeconds },
      );
    },
  };
  return Object.freeze(storage);
}

export async function ensureS3Buckets(config: S3ObjectStorageConfig): Promise<void> {
  const client = new S3Client({
    credentials: config.credentials,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
  });
  try {
    for (const Bucket of Object.values(config.buckets)) {
      try {
        await client.send(new CreateBucketCommand({ Bucket }));
      } catch (error) {
        if (
          !isAwsError(error) ||
          (error.name !== "BucketAlreadyOwnedByYou" &&
            error.name !== "BucketAlreadyExists" &&
            error.$metadata?.httpStatusCode !== 409)
        ) throw error;
      }
    }
  } finally {
    client.destroy();
  }
}

function assertObjectKey(key: string): void {
  if (
    key.length === 0 ||
    key.length > 512 ||
    key.startsWith("/") ||
    key.includes("..") ||
    !/^[A-Za-z0-9][A-Za-z0-9./_-]*$/u.test(key)
  ) {
    throw new TypeError("Object key is invalid");
  }
}

function isOverwriteRefusal(error: unknown): boolean {
  return (
    isAwsError(error) &&
    (error.name === "PreconditionFailed" ||
      error.name === "ConditionalRequestConflict" ||
      error.$metadata?.httpStatusCode === 409 ||
      error.$metadata?.httpStatusCode === 412)
  );
}

function isMissingObject(error: unknown): boolean {
  return (
    isAwsError(error) &&
    (error.name === "NoSuchKey" ||
      error.name === "NotFound" ||
      error.$metadata?.httpStatusCode === 404)
  );
}

function isAwsError(
  error: unknown,
): error is { readonly $metadata?: { readonly httpStatusCode?: number }; readonly name?: string } {
  return error !== null && typeof error === "object";
}

function isStoredObjectResponse(value: unknown): value is {
  readonly Body: { transformToByteArray(): Promise<Uint8Array> };
  readonly ContentLength: number;
  readonly ContentType: string;
  readonly Metadata: Readonly<Record<string, string>> & { readonly sha256: string };
} {
  if (value === null || typeof value !== "object") return false;
  const body = "Body" in value ? value.Body : undefined;
  const metadata = "Metadata" in value ? value.Metadata : undefined;
  return (
    body !== null && typeof body === "object" &&
    "transformToByteArray" in body && typeof body.transformToByteArray === "function" &&
    "ContentLength" in value && typeof value.ContentLength === "number" &&
    "ContentType" in value && typeof value.ContentType === "string" &&
    metadata !== null && typeof metadata === "object" &&
    "sha256" in metadata && typeof metadata.sha256 === "string"
  );
}
