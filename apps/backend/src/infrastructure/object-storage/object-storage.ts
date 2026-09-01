export type ObjectStorageNamespace = "protected" | "public" | "quarantine";

export interface StoredObject {
  readonly body: Uint8Array;
  readonly checksumSha256: string;
  readonly contentLength: number;
  readonly contentType: string;
}

export type PutImmutableObjectResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: { readonly code: "object_already_exists" };
    };

export interface ObjectStorage {
  putImmutable(input: {
    readonly body: Uint8Array;
    readonly checksumSha256: string;
    readonly contentType: string;
    readonly key: string;
    readonly namespace: ObjectStorageNamespace;
  }): Promise<PutImmutableObjectResult>;
  read(
    namespace: ObjectStorageNamespace,
    key: string,
  ): Promise<StoredObject | null>;
  delete(namespace: ObjectStorageNamespace, key: string): Promise<void>;
  signGet(input: {
    readonly contentDisposition?: string;
    readonly contentType?: string;
    readonly key: string;
    readonly namespace: ObjectStorageNamespace;
    readonly ttlSeconds: number;
  }): Promise<string>;
}

export function assertPresignedGetTtl(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 300) {
    throw new RangeError("ttlSeconds must be between 1 and 300");
  }
}
