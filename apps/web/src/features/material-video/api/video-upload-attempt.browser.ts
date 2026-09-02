import { z } from "zod";

export interface BrowserVideoUploadAttempt {
  readonly storageKey?: string;
  readonly submissionId: string;
  readonly videoId?: string;
}

const storedUploadAttemptSchema = z.object({
  submissionId: z.uuid(),
  version: z.literal(1),
}).strict();

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
    localStorage.setItem(storageKey, JSON.stringify({ submissionId, version: 1 }));
  } catch {
    // Upload remains available when storage is disabled, with server-side fail-closed protection.
  }
  return { storageKey, submissionId };
}

export function clearBrowserVideoUploadAttempt(attempt: BrowserVideoUploadAttempt): void {
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
