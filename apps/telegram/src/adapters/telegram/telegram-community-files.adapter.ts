import { z } from "zod";
import type { CommunityFiles } from "../../modules/community-discussions/community-files.js";
import { readBoundedJson } from "../platform/read-bounded-json.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const fileResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    file_path: z.string().min(1).max(1000),
    file_size: z.int().nonnegative().optional(),
  }),
});

export class TelegramCommunityFilesAdapter implements CommunityFiles {
  constructor(
    private readonly botToken: string | undefined,
    private readonly apiBase = "https://api.telegram.org",
    private readonly limits = {
      maxBytes: MAX_FILE_BYTES,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    },
  ) {}

  async download(fileId: string, signal?: AbortSignal): Promise<Uint8Array> {
    const deadline = AbortSignal.timeout(this.limits.timeoutMs);
    const cancellation = signal
      ? AbortSignal.any([signal, deadline])
      : deadline;
    try {
      cancellation.throwIfAborted();
      if (this.botToken === undefined || this.botToken.length === 0)
        throw new Error("Not configured");
      const metadata = await fetch(
        `${this.apiBase}/bot${this.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
        {
          redirect: "error",
          signal: cancellation,
        },
      );
      if (!metadata.ok) {
        void metadata.body?.cancel().catch(() => {
          // Cleanup cannot replace the download outcome.
        });
        throw new Error("File lookup failed");
      }
      const file = fileResponseSchema.parse(
        await readBoundedJson(metadata, 16_384, cancellation),
      ).result;
      const segments = file.file_path.split("/");
      if (
        segments.some(
          (part) => part.length === 0 || part === "." || part === "..",
        ) ||
        (file.file_size ?? 0) > this.limits.maxBytes
      )
        throw new Error("Invalid file metadata");
      const path = segments.map(encodeURIComponent).join("/");
      const response = await fetch(
        `${this.apiBase}/file/bot${this.botToken}/${path}`,
        { redirect: "error", signal: cancellation },
      );
      if (
        !response.ok ||
        !response.body ||
        Number(response.headers.get("content-length") ?? 0) >
          this.limits.maxBytes
      ) {
        void response.body?.cancel().catch(() => {
          // Cleanup cannot replace the download outcome.
        });
        throw new Error("File unavailable");
      }
      const reader = response.body.getReader();
      let complete = false;
      try {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          cancellation.throwIfAborted();
          const part = await reader.read();
          if (part.done) {
            complete = true;
            break;
          }
          size += part.value.byteLength;
          if (size > this.limits.maxBytes) throw new Error("File too large");
          chunks.push(part.value);
        }
        return Buffer.concat(chunks);
      } finally {
        if (!complete)
          void reader.cancel().catch(() => {
            // Cleanup cannot replace the download outcome.
          });
        reader.releaseLock();
      }
    } catch {
      // Fetch and Bot API errors can contain the credential-bearing request URL.
      throw new Error("Community file download failed");
    }
  }
}
