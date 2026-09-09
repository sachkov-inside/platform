import { queryOptions } from "@tanstack/react-query";

import {
  requestSameOriginMutation,
  type SameOriginMutationResult,
} from "@/shared/api/same-origin-mutation";
import {
  guideArtifactListStateSchema,
  guideArtifactMutationResultSchema,
  type GuideArtifactAccess,
  type GuideArtifactListState,
  type GuideArtifactMutationResult,
} from "../model/guide-artifacts";

export interface GuideArtifactMetadataDraft {
  readonly access: GuideArtifactAccess;
  readonly purpose: string;
  readonly title: string;
}

export const guideArtifactsQueryOptions = (guideId: string) =>
  queryOptions({
    gcTime: 0,
    queryFn: ({ signal }) =>
      readArtifactList(
        `/api/authoring/guides/${encodeURIComponent(guideId)}/artifacts`,
        signal,
      ),
    queryKey: ["guide-artifacts", guideId],
    refetchOnWindowFocus: false,
  });

export const reusableGuideArtifactsQueryOptions = () =>
  queryOptions({
    gcTime: 0,
    queryFn: ({ signal }) =>
      readArtifactList("/api/authoring/guide-artifacts/reusable", signal),
    queryKey: ["guide-artifacts", "reusable"],
    refetchOnWindowFocus: false,
  });

export async function createGuideArtifactFromFile(input: {
  readonly file: File;
  readonly guideId: string;
  readonly metadata: GuideArtifactMetadataDraft;
}): Promise<GuideArtifactMutationResult> {
  const body = new FormData();
  appendMetadata(body, input.metadata);
  body.set("guideId", input.guideId);
  await appendFile(body, input.file);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/guide-artifacts/uploads",
      "POST",
      body,
    ),
  );
}

export async function createGuideArtifactFromLink(input: {
  readonly externalUrl: string;
  readonly guideId: string;
  readonly metadata: GuideArtifactMetadataDraft;
}): Promise<GuideArtifactMutationResult> {
  const body = new FormData();
  appendMetadata(body, input.metadata);
  body.set("externalUrl", input.externalUrl);
  body.set("guideId", input.guideId);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/guide-artifacts/links",
      "POST",
      body,
    ),
  );
}

export async function updateGuideArtifact(input: {
  readonly artifactId: string;
  readonly metadata: GuideArtifactMetadataDraft;
}): Promise<GuideArtifactMutationResult> {
  const body = new FormData();
  appendMetadata(body, input.metadata);
  body.set("artifactId", input.artifactId);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/guide-artifacts/metadata",
      "PATCH",
      body,
    ),
  );
}

export async function replaceGuideArtifactFile(input: {
  readonly artifactId: string;
  readonly file: File;
}): Promise<GuideArtifactMutationResult> {
  const body = new FormData();
  body.set("artifactId", input.artifactId);
  await appendFile(body, input.file);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/guide-artifacts/file",
      "PUT",
      body,
    ),
  );
}

export async function replaceGuideArtifactLink(input: {
  readonly artifactId: string;
  readonly externalUrl: string;
}): Promise<GuideArtifactMutationResult> {
  const body = new FormData();
  body.set("artifactId", input.artifactId);
  body.set("externalUrl", input.externalUrl);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/guide-artifacts/link",
      "PUT",
      body,
    ),
  );
}

export async function setGuideArtifactArchived(input: {
  readonly archived: boolean;
  readonly artifactId: string;
}): Promise<GuideArtifactMutationResult> {
  const body = new FormData();
  body.set("archived", String(input.archived));
  body.set("artifactId", input.artifactId);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/guide-artifacts/archive",
      "PUT",
      body,
    ),
  );
}

export async function setGuideArtifactGuides(input: {
  readonly artifactId: string;
  readonly guideIds: readonly string[];
}): Promise<GuideArtifactMutationResult> {
  const body = new FormData();
  body.set("artifactId", input.artifactId);
  body.set("guideIds", JSON.stringify(input.guideIds));
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/guide-artifacts/placements",
      "PUT",
      body,
    ),
  );
}

export async function removeGuideArtifact(input: {
  readonly artifactId: string;
}): Promise<GuideArtifactMutationResult> {
  const body = new FormData();
  body.set("artifactId", input.artifactId);
  return interpret(
    await requestSameOriginMutation(
      "/api/authoring/guide-artifacts/removal",
      "DELETE",
      body,
    ),
  );
}

async function readArtifactList(
  url: string,
  signal: AbortSignal,
): Promise<GuideArtifactListState> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("guide-artifacts-read");
  return guideArtifactListStateSchema.parse(await response.json());
}

/** Maps one BFF outcome to the single artifact mutation result the panel reads. */
export function interpret(
  result: SameOriginMutationResult,
): GuideArtifactMutationResult {
  if (!result.ok) {
    if (result.status === 401 || result.status === 403) {
      return { kind: "unauthorized" };
    }
    if (result.status === 413) {
      return { kind: "rejected", reason: "Файл больше допустимого размера." };
    }
    if (result.status === 400 || result.status === 422) {
      return {
        kind: "rejected",
        reason:
          "Такой файл нельзя приложить: он выглядит как программа или скрипт.",
      };
    }
    return {
      kind: "error",
      reference: `guide-artifacts-bff-${String(result.status)}`,
    };
  }
  const parsed = guideArtifactMutationResultSchema.safeParse(result.body);
  return parsed.success
    ? parsed.data
    : { kind: "error", reference: "guide-artifacts-bff-contract" };
}

function appendMetadata(body: FormData, metadata: GuideArtifactMetadataDraft): void {
  body.set("access", metadata.access);
  body.set("purpose", metadata.purpose);
  body.set("title", metadata.title);
}

async function appendFile(body: FormData, file: File): Promise<void> {
  body.set("checksumSha256", await sha256(file));
  body.set("declaredSize", String(file.size));
  body.set("file", file);
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
