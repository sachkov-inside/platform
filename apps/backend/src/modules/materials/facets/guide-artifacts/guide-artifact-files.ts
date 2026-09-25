import { randomUUID } from "node:crypto";

import type {
  ObjectStorage,
  ObjectStorageNamespace,
} from "../../../../infrastructure/object-storage/index.js";
import { dependencyFailure, reportDependencyFailure } from "../../../../infrastructure/observability/index.js";
import { processMaterialAssetBytes } from "../../../assets/index.js";
import { dependencyUnavailable } from "./guide-artifact-records.js";
import type { GuideArtifactResult, UploadedArtifactFile } from "./guide-artifacts.js";

export interface StoredArtifactFile {
  readonly checksumSha256: string;
  readonly contentType: string;
  readonly filename: string;
  readonly objectNonce: string;
  readonly protectedObjectKey: string;
  readonly publicObjectKey: string;
  readonly quarantineObjectKey: string;
  readonly size: number;
}

/**
 * The bytes of one artifact version. An upload lands in quarantine, is checked, then written
 * immutably to the protected and public namespaces before any database row names it.
 */
export interface GuideArtifactFiles {
  store(artifactId: string, file: UploadedArtifactFile): Promise<GuideArtifactResult<StoredArtifactFile>>;
  /** The version row is committed: the quarantine copy has no further use. */
  forgetQuarantine(stored: StoredArtifactFile | null): Promise<void>;
  /** No row names the stored objects: forget all of them. */
  discard(stored: StoredArtifactFile | null): Promise<void>;
}

export function assembleGuideArtifactFiles(objectStorage: ObjectStorage): GuideArtifactFiles {
  async function putObject(input: {
    readonly body: Uint8Array;
    readonly checksumSha256: string;
    readonly contentType: string;
    readonly key: string;
    readonly namespace: ObjectStorageNamespace;
  }): Promise<GuideArtifactResult<null>> {
    try {
      const result = await objectStorage.putImmutable(input);
      return result.ok ? { ok: true, value: null } : dependencyUnavailable();
    } catch (error) {
      return dependencyFailure({ module: "materials", operation: "putObject" }, error, dependencyUnavailable());
    }
  }

  async function forgetObject(
    namespace: ObjectStorageNamespace,
    key: string,
  ): Promise<void> {
    try {
      await objectStorage.delete(namespace, key);
    } catch (error) {
      // Quarantine and abandoned objects are immutable and unreferenced; a
      // failed cleanup never blocks the author-visible outcome.
      reportDependencyFailure({ module: "materials", operation: "forgetObject" }, error);
    }
  }

  const files: GuideArtifactFiles = {
    async store(artifactId, file) {
      const objectNonce = randomUUID();
      const prefix = `guide-artifacts/${artifactId}/${objectNonce}`;
      const quarantineObjectKey = `${prefix}/quarantine`;
      const put = await putObject({
        body: file.body,
        checksumSha256: file.expectedChecksumSha256,
        contentType: file.declaredContentType,
        key: quarantineObjectKey,
        namespace: "quarantine",
      });
      if (!put.ok) return put;

      const processed = await processMaterialAssetBytes({
        body: file.body,
        declaredContentType: file.declaredContentType,
        declaredSize: file.declaredSize,
        expectedChecksumSha256: file.expectedChecksumSha256,
        filename: file.filename,
        kind: "file",
      });
      if (!processed.ok || processed.value.kind !== "file") {
        await forgetObject("quarantine", quarantineObjectKey);
        return {
          error: {
            code: "invalid_content",
            reason: processed.ok ? "unsupported_file_type" : processed.error.code,
          },
          ok: false,
        };
      }

      const protectedObjectKey = `${prefix}/file`;
      const publicObjectKey = `${prefix}/public-file`;
      const object = {
        body: processed.value.body,
        checksumSha256: processed.value.checksumSha256,
        contentType: processed.value.contentType,
      };
      const written = await Promise.all([
        putObject({ ...object, key: protectedObjectKey, namespace: "protected" }),
        putObject({ ...object, key: publicObjectKey, namespace: "public" }),
      ]);
      const failed = written.find((result) => !result.ok);
      if (failed !== undefined && !failed.ok) {
        await forgetObject("quarantine", quarantineObjectKey);
        return failed;
      }
      return {
        ok: true,
        value: {
          checksumSha256: processed.value.checksumSha256,
          contentType: processed.value.contentType,
          filename: file.filename,
          objectNonce,
          protectedObjectKey,
          publicObjectKey,
          quarantineObjectKey,
          size: processed.value.size,
        },
      };
    },

    async forgetQuarantine(stored) {
      if (stored !== null) await forgetObject("quarantine", stored.quarantineObjectKey);
    },

    async discard(stored) {
      if (stored === null) return;
      await Promise.all([
        forgetObject("quarantine", stored.quarantineObjectKey),
        forgetObject("protected", stored.protectedObjectKey),
        forgetObject("public", stored.publicObjectKey),
      ]);
    },
  };
  return Object.freeze(files);
}
