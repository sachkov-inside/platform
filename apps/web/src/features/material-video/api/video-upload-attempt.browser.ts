import { z } from "zod";

export interface BrowserVideoUploadAttempt {
  readonly storageKey?: string;
  readonly submissionId: string;
  readonly videoId?: string;
}

const storedUploadAttemptSchema = z
  .object({
    submissionId: z.uuid(),
    version: z.literal(1),
    videoId: z.uuid().optional(),
  })
  .strict();

export async function getOrCreateBrowserVideoUploadAttempt(
  materialId: string,
  file: File,
): Promise<BrowserVideoUploadAttempt> {
  let storageKey: string;
  try {
    const fingerprint = new TextEncoder().encode(
      `${file.name}\u0000${String(file.size)}\u0000${String(file.lastModified)}`,
    );
    const digest = await crypto.subtle.digest("SHA-256", fingerprint);
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    storageKey = `inside.video-upload.v1:${materialId}:${hash}`;
    const stored = storedUploadAttemptSchema.safeParse(
      JSON.parse(localStorage.getItem(storageKey) ?? "null"),
    );
    if (stored.success) {
      return { storageKey, submissionId: stored.data.submissionId };
    }
  } catch {
    return { submissionId: crypto.randomUUID() };
  }
  const submissionId = crypto.randomUUID();
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ submissionId, version: 1 }),
    );
  } catch {
    // Upload remains available when storage is disabled, with server-side fail-closed protection.
  }
  return { storageKey, submissionId };
}

/** Keep the upload's identity across editor reloads without changing its retry key. */
export function recordBrowserVideoUploadAttempt(
  attempt: BrowserVideoUploadAttempt,
  videoId: string,
): void {
  if (attempt.storageKey === undefined) return;
  try {
    const stored = storedUploadAttemptSchema.safeParse(
      JSON.parse(localStorage.getItem(attempt.storageKey) ?? "null"),
    );
    if (stored.success && stored.data.submissionId === attempt.submissionId) {
      localStorage.setItem(
        attempt.storageKey,
        JSON.stringify({ ...stored.data, videoId }),
      );
    }
  } catch {
    // Identity recording is best-effort when storage is unavailable.
  }
}

/** A recovered upload has no in-memory attempt; discard its persisted retry key on «Убрать». */
export function clearRecoveredBrowserVideoUploadAttempt(
  materialId: string,
  videoId: string,
): void {
  try {
    const prefix = `inside.video-upload.v1:${materialId}:`;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key === null || !key.startsWith(prefix)) continue;
      const stored = storedUploadAttemptSchema.safeParse(
        JSON.parse(localStorage.getItem(key) ?? "null"),
      );
      // Legacy attempts lack a Video identity. Retire only this Material's unidentifiable keys.
      if (
        stored.success &&
        (stored.data.videoId === undefined || stored.data.videoId === videoId)
      ) {
        clearBrowserVideoUploadAttempt({
          storageKey: key,
          submissionId: stored.data.submissionId,
        });
      }
    }
  } catch {
    // Cleanup is best-effort when storage is unavailable.
  }
}

export function clearBrowserVideoUploadAttempt(
  attempt: BrowserVideoUploadAttempt,
): void {
  if (attempt.storageKey === undefined) return;
  try {
    const stored = storedUploadAttemptSchema.safeParse(
      JSON.parse(localStorage.getItem(attempt.storageKey) ?? "null"),
    );
    if (stored.success && stored.data.submissionId === attempt.submissionId) {
      localStorage.removeItem(attempt.storageKey);
    }
  } catch {
    // Cleanup is best-effort when storage is unavailable.
  }
}
