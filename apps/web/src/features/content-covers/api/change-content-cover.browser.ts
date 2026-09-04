import { z } from "zod";

import { contentCoverSchema, type ContentCover } from "@/entities/material";

const responseSchema = z
  .object({ cover: contentCoverSchema.nullable() })
  .strict();

export type ContentCoverChangeResult =
  | { readonly cover: ContentCover | null; readonly kind: "saved" }
  | { readonly kind: "conflict" }
  | { readonly kind: "error" };

export async function uploadContentCover(input: {
  readonly currentCover: ContentCover | null;
  readonly file: File;
  readonly ownerId: string;
  readonly ownerKind: "material" | "series" | "topic";
}): Promise<ContentCoverChangeResult> {
  const body = new FormData();
  body.set("checksumSha256", await sha256(input.file));
  body.set("declaredSize", String(input.file.size));
  body.set("expectedCoverId", input.currentCover?.coverId ?? "null");
  body.set("file", input.file);
  return parseChangeResponse(
    await fetch(
      `/api/authoring/content-covers/${input.ownerKind}/${encodeURIComponent(input.ownerId)}`,
      { body, method: "PUT" },
    ),
  );
}

export async function removeContentCover(input: {
  readonly currentCover: ContentCover;
  readonly ownerId: string;
  readonly ownerKind: "material" | "series" | "topic";
}): Promise<ContentCoverChangeResult> {
  return parseChangeResponse(
    await fetch(
      `/api/authoring/content-covers/${input.ownerKind}/${encodeURIComponent(input.ownerId)}`,
      {
        body: JSON.stringify({ expectedCoverId: input.currentCover.coverId }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      },
    ),
  );
}

async function parseChangeResponse(
  response: Response,
): Promise<ContentCoverChangeResult> {
  if (response.status === 409) return { kind: "conflict" };
  if (!response.ok) return { kind: "error" };
  const parsed = responseSchema.safeParse(await response.json());
  return parsed.success
    ? { cover: parsed.data.cover, kind: "saved" }
    : { kind: "error" };
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
