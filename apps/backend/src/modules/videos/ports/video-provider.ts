import type { VideoAccess } from "../facets/videos/videos.interface.js";

export interface ProviderVideo {
  readonly embedLocator: string | null;
  readonly id: string;
  readonly message?: string;
  readonly projectId: string;
  readonly status: string;
  readonly title: string;
}

export interface VideoProvider {
  initUpload(input: {
    readonly access: VideoAccess;
    readonly byteSize: number;
    readonly filename: string;
    readonly projectId: string;
    readonly title: string;
  }): Promise<{ readonly id: string; readonly uploadEndpoint: string }>;
  find(input: {
    readonly id: string;
    readonly projectId: string;
  }): Promise<ProviderVideo | null>;
}
