import type { VideoAccess } from "../facets/videos/videos.interface.js";

export interface ProviderVideo {
  readonly embedLocator: string | null;
  readonly id: string;
  readonly message?: string;
  readonly projectId: string;
  readonly status: string;
  readonly title: string;
}

export type ProviderDeleteFailureCategory =
  | "authentication"
  | "invalid_request"
  | "invalid_response"
  | "network"
  | "permission"
  | "provider_unavailable"
  | "rate_limited"
  | "timeout";

export type ProviderDeleteOutcome =
  | Readonly<{ kind: "deleted"; providerRequestId?: string }>
  | Readonly<{ kind: "not_found"; providerRequestId?: string }>
  | Readonly<{
      category: Extract<
        ProviderDeleteFailureCategory,
        "network" | "provider_unavailable" | "rate_limited" | "timeout"
      >;
      kind: "retryable_failure";
      providerRequestId?: string;
    }>
  | Readonly<{
      category: Extract<
        ProviderDeleteFailureCategory,
        "authentication" | "invalid_request" | "invalid_response" | "permission"
      >;
      kind: "terminal_failure";
      providerRequestId?: string;
    }>;

export interface VideoProvider {
  delete(input: { readonly id: string }): Promise<ProviderDeleteOutcome>;
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
