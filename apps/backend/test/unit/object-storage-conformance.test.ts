import {
  assertPresignedGetTtl,
  type ObjectStorage,
  type ObjectStorageNamespace,
  type StoredObject,
} from "../../src/infrastructure/object-storage/index.js";
import { objectStorageConformance } from "../support/object-storage-conformance.js";

class MemoryObjectStorage implements ObjectStorage {
  readonly #objects = new Map<string, StoredObject>();

  putImmutable(input: {
    readonly body: Uint8Array;
    readonly checksumSha256: string;
    readonly contentType: string;
    readonly key: string;
    readonly namespace: ObjectStorageNamespace;
  }) {
    const locator = `${input.namespace}/${input.key}`;
    if (this.#objects.has(locator)) {
      return Promise.resolve({ ok: false as const, error: { code: "object_already_exists" as const } });
    }
    this.#objects.set(locator, {
      body: input.body,
      checksumSha256: input.checksumSha256,
      contentLength: input.body.byteLength,
      contentType: input.contentType,
    });
    return Promise.resolve({ ok: true as const });
  }

  read(namespace: ObjectStorageNamespace, key: string) {
    return Promise.resolve(this.#objects.get(`${namespace}/${key}`) ?? null);
  }

  delete(namespace: ObjectStorageNamespace, key: string) {
    this.#objects.delete(`${namespace}/${key}`);
    return Promise.resolve();
  }

  signGet(input: {
    readonly contentDisposition?: string;
    readonly contentType?: string;
    readonly key: string;
    readonly namespace: ObjectStorageNamespace;
    readonly ttlSeconds: number;
  }) {
    return Promise.resolve().then(() => {
      assertPresignedGetTtl(input.ttlSeconds);
      return `https://storage.example/${input.namespace}/${input.key}?ttl=${String(input.ttlSeconds)}`;
    });
  }
}

objectStorageConformance("MemoryObjectStorage", () => new MemoryObjectStorage());
