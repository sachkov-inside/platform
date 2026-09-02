import "server-only";

import { MaterialVideoAuthoringService, VideoPlaybackService } from "./generated/platform-api";
import { executeGeneratedRequest, type BackendTransportResult } from "./transport-core.server";

export function requestVideoPlayback(
  materialId: string,
  videoId: string,
  accessToken?: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new VideoPlaybackService(request).createVideoPlaybackSession({ materialId, videoId }),
    200,
    { ...(accessToken === undefined ? {} : { accessToken }) },
  );
}

export function requestVideoProgress(
  input: {
    readonly durationSeconds: number;
    readonly materialId: string;
    readonly positionSeconds: number;
    readonly videoId: string;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new VideoPlaybackService(request).saveVideoPlaybackProgress({
      materialId: input.materialId,
      videoId: input.videoId,
      requestBody: {
        durationSeconds: input.durationSeconds,
        positionSeconds: input.positionSeconds,
      },
    }),
    204,
    { accessToken },
  );
}

export function requestVideoUploadInit(
  input: {
    readonly access: "free" | "membership";
    readonly byteSize: number;
    readonly filename: string;
    readonly idempotencyKey: string;
    readonly materialId: string;
    readonly title: string;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialVideoAuthoringService(request).initMaterialVideoUpload({
      idempotencyKey: input.idempotencyKey,
      materialId: input.materialId,
      requestBody: {
        access: input.access,
        byteSize: input.byteSize,
        filename: input.filename,
        title: input.title,
      },
    }),
    201,
    { accessToken },
  );
}

export function requestVideoAttach(
  input: {
    readonly access: "free" | "membership";
    readonly materialId: string;
    readonly providerVideoId: string;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialVideoAuthoringService(request).attachMaterialVideo({
      materialId: input.materialId,
      requestBody: { access: input.access, providerVideoId: input.providerVideoId },
    }),
    201,
    { accessToken },
  );
}

export function requestVideoReconcile(
  videoId: string,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialVideoAuthoringService(request).reconcileMaterialVideo({ videoId }),
    200,
    { accessToken },
  );
}

export function requestVideoDeletionRetry(
  videoId: string,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialVideoAuthoringService(request).retryMaterialVideoDeletion({ videoId }),
    200,
    { accessToken },
  );
}
