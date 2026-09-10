import "server-only";

import { MaterialAuthoringService } from "./generated/platform-api/services/MaterialAuthoringService";
import {
  executeGeneratedRequest,
  readBackendBaseUrl,
  type BackendTransportResult,
} from "./transport-core.server";

const GUIDE_ARTIFACT_UPLOAD_TIMEOUT_MS = 60_000;

export interface GuideArtifactMetadataInput {
  readonly access: "free" | "membership";
  readonly purpose: string;
  readonly title: string;
}

export function requestGuideArtifactsForGuide(
  guideId: string,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).listAuthoringGuideArtifacts({
        guideId,
      }),
    200,
    { accessToken },
  );
}

export function requestReusableGuideArtifacts(
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialAuthoringService(request).listReusableGuideArtifacts(),
    200,
    { accessToken },
  );
}

export function requestCreateGuideArtifactFromLink(
  input: GuideArtifactMetadataInput & {
    readonly externalUrl: string;
    readonly guideId: string;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).createGuideArtifactFromLink({
        requestBody: input,
      }),
    201,
    { accessToken },
  );
}

export function requestUpdateGuideArtifact(
  input: GuideArtifactMetadataInput & { readonly artifactId: string },
  accessToken: string,
): Promise<BackendTransportResult> {
  const { artifactId, ...metadata } = input;
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).updateGuideArtifact({
        artifactId,
        requestBody: metadata,
      }),
    200,
    { accessToken },
  );
}

export function requestReplaceGuideArtifactLink(
  input: { readonly artifactId: string; readonly externalUrl: string },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).replaceGuideArtifactLink({
        artifactId: input.artifactId,
        requestBody: { externalUrl: input.externalUrl },
      }),
    200,
    { accessToken },
  );
}

export function requestSetGuideArtifactArchived(
  input: { readonly archived: boolean; readonly artifactId: string },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).setGuideArtifactArchived({
        artifactId: input.artifactId,
        requestBody: { archived: input.archived },
      }),
    200,
    { accessToken },
  );
}

export function requestSetGuideArtifactGuides(
  input: { readonly artifactId: string; readonly guideIds: readonly string[] },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).setGuideArtifactGuides({
        artifactId: input.artifactId,
        requestBody: { guideIds: [...input.guideIds] },
      }),
    200,
    { accessToken },
  );
}

export function requestRemoveGuideArtifact(
  artifactId: string,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).removeGuideArtifact({ artifactId }),
    200,
    { accessToken },
  );
}

/**
 * File uploads stream straight through the BFF: the artifact body may reach the
 * 25 MiB product limit, which no buffered mutation boundary carries.
 */
export function requestCreateGuideArtifactFile(input: {
  readonly accessToken: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly signal: AbortSignal;
}): Promise<Response> {
  return streamUpload(
    `${readBackendBaseUrl()}/authoring/guide-artifacts/files`,
    "POST",
    input,
  );
}

export function requestReplaceGuideArtifactFile(input: {
  readonly accessToken: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly signal: AbortSignal;
}): Promise<Response> {
  return streamUpload(
    `${readBackendBaseUrl()}/authoring/guide-artifacts/file`,
    "PUT",
    input,
  );
}

function streamUpload(
  url: string,
  method: "POST" | "PUT",
  input: {
    readonly accessToken: string;
    readonly body: ReadableStream<Uint8Array>;
    readonly contentType: string;
    readonly signal: AbortSignal;
  },
): Promise<Response> {
  return fetch(url, {
    body: input.body,
    cache: "no-store",
    duplex: "half",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": input.contentType,
    },
    method,
    signal: AbortSignal.any([
      input.signal,
      AbortSignal.timeout(GUIDE_ARTIFACT_UPLOAD_TIMEOUT_MS),
    ]),
  } as RequestInit & { duplex: "half" });
}
