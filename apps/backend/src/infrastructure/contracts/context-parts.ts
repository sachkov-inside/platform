import { createHash } from "node:crypto";

// Small bounded tool responses avoid native client output truncation. Splitting by Unicode code
// point preserves every character; clients must consume all parts, not only the last.
const PART_CHARACTERS = 6_000;

export function contentSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface ContextPart {
  readonly contentSha256: string;
  readonly contentBytes: number;
  readonly part: number;
  readonly partCount: number;
  readonly data: string;
  readonly partSha256: string;
  readonly complete: boolean;
  readonly endOfContext: boolean;
  readonly nextPart: number | null;
}

/**
 * One numbered part of a serialized learner context, as lesson practice and Product Task reads
 * return it: whole-content and per-part SHA-256, the part count and the next part to request.
 */
export function contextPart(
  serialized: string,
  part: number,
):
  | { readonly ok: true; readonly value: ContextPart }
  | { readonly ok: false; readonly partCount: number } {
  const characters = Array.from(serialized);
  const partCount = Math.ceil(characters.length / PART_CHARACTERS);
  if (part >= partCount) return { ok: false, partCount };
  const data = characters
    .slice(part * PART_CHARACTERS, (part + 1) * PART_CHARACTERS)
    .join("");
  return {
    ok: true,
    value: {
      contentSha256: contentSha256(serialized),
      contentBytes: Buffer.byteLength(serialized, "utf8"),
      part,
      partCount,
      data,
      partSha256: contentSha256(data),
      complete: partCount === 1,
      endOfContext: part === partCount - 1,
      nextPart: part === partCount - 1 ? null : part + 1,
    },
  };
}
