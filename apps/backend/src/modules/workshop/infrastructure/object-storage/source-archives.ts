import { createHash } from "node:crypto";

import { z } from "zod";

import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import type {
  SourceArchives,
  StoreSourceArchiveResult,
  StoredSourceArchive,
} from "../../ports/source-archives.js";

const MAX_SOURCE_ARCHIVE_BYTES = 50 * 1024 * 1024;
const inputSchema = z
  .object({
    body: z.instanceof(Uint8Array).refine(
      (body) => body.byteLength > 0 && body.byteLength <= MAX_SOURCE_ARCHIVE_BYTES,
    ),
    contentType: z.string().trim().min(1).max(255),
    retentionTime: z.iso.datetime({ offset: true }),
  })
  .strict();

export function assembleSourceArchives(
  objectStorage: ObjectStorage,
): SourceArchives {
  const sourceArchives: SourceArchives = {
    async store(input): Promise<StoreSourceArchiveResult> {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return failure("invalid_archive");

      const digest = createHash("sha256").update(parsed.data.body).digest("hex");
      const archive: StoredSourceArchive = {
        key: `workshop/source-archives/${digest}`,
        digest,
        byteSize: parsed.data.body.byteLength,
        retentionTime: parsed.data.retentionTime,
      };
      try {
        const stored = await objectStorage.putImmutable({
          body: parsed.data.body,
          checksumSha256: digest,
          contentType: parsed.data.contentType,
          key: archive.key,
          namespace: "protected",
        });
        if (stored.ok) return { ok: true, value: archive };

        const existing = await objectStorage.read("protected", archive.key);
        if (
          existing === null ||
          existing.checksumSha256 !== digest ||
          existing.contentLength !== archive.byteSize ||
          existing.contentType !== parsed.data.contentType
        ) {
          return failure("dependency_unavailable");
        }
        return { ok: true, value: archive };
      } catch {
        return failure("dependency_unavailable");
      }
    },
  };
  return Object.freeze(sourceArchives);
}

function failure(
  code: Extract<StoreSourceArchiveResult, { readonly ok: false }>["error"]["code"],
): Extract<StoreSourceArchiveResult, { readonly ok: false }> {
  return { ok: false, error: { code } };
}
