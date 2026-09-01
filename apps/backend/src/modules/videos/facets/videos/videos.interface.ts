export type VideoAccess = "free" | "membership";
export type VideoState = "uploading" | "processing" | "ready" | "failed";

export interface VideoDto {
  readonly access: VideoAccess;
  readonly materialId: string;
  readonly state: VideoState;
  readonly title: string;
  readonly videoId: string;
  readonly failureCode?: string;
}

export interface VideoPresentation {
  readonly state: VideoState;
  readonly title: string;
  readonly videoId: string;
  readonly failureCode?: string;
}

export interface VideoAccessFacts {
  readonly access: VideoAccess;
  readonly materialId: string;
  readonly videoId: string;
}

export interface VideoPlayback {
  readonly access: VideoAccess;
  readonly embedLocator: string;
  readonly materialId: string;
  readonly providerVideoId: string;
  readonly videoId: string;
}

export type VideoError =
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "forbidden" }
  | { readonly code: "idempotency_key_reused" }
  | { readonly code: "invalid_request" }
  | { readonly code: "provider_mismatch" }
  | { readonly code: "upload_outcome_unknown" }
  | { readonly code: "video_not_found" }
  | { readonly code: "video_not_ready" };

export type VideoResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: VideoError }>;

export interface Videos {
  initUpload(input: {
    readonly access: VideoAccess;
    readonly actor: string;
    readonly byteSize: number;
    readonly filename: string;
    readonly idempotencyKey: string;
    readonly materialId: string;
    readonly title: string;
  }): Promise<VideoResult<{ readonly uploadEndpoint: string; readonly video: VideoDto }>>;
  attachExisting(input: {
    readonly access: VideoAccess;
    readonly actor: string;
    readonly materialId: string;
    readonly providerVideoId: string;
  }): Promise<VideoResult<VideoDto>>;
  reconcile(input: {
    readonly actor: string;
    readonly videoId: string;
  }): Promise<VideoResult<VideoDto>>;
  acceptWebhook(input: {
    readonly event: string;
    readonly providerStatus?: string;
    readonly providerVideoId: string;
  }): Promise<VideoResult<void>>;
  inspectPrimaryReference(input: {
    readonly access: VideoAccess;
    readonly materialId: string;
    readonly videoId: string;
  }): Promise<VideoResult<void>>;
  loadPresentation(input: {
    readonly materialId: string;
    readonly videoId: string;
  }): Promise<VideoResult<VideoPresentation | null>>;
  loadAccessFacts(videoIds: readonly string[]): Promise<VideoResult<readonly VideoAccessFacts[]>>;
  loadPlayback(videoId: string): Promise<VideoResult<VideoPlayback | null>>;
  loadProgress(input: {
    readonly accountId: string;
    readonly videoId: string;
  }): Promise<VideoResult<{ readonly positionSeconds: number } | null>>;
  saveProgress(input: {
    readonly accountId: string;
    readonly durationSeconds: number;
    readonly positionSeconds: number;
    readonly videoId: string;
  }): Promise<VideoResult<void>>;
}
