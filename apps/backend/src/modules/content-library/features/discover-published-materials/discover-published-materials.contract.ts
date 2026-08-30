import type { Subject } from "../../../content-access/index.js";
import type { PublishedMaterialCatalogItemDto } from "../list-published-materials/list-published-materials.contract.js";

export interface DiscoverPublishedMaterialsQuery {
  readonly first: number;
  readonly kind: "related" | "series" | "topic";
  readonly slug: string;
  readonly subject: Subject;
}

export interface PublishedMaterialDiscoveryDto {
  readonly hasNext: boolean;
  readonly items: readonly PublishedMaterialCatalogItemDto[];
  readonly kind: "related" | "series" | "topic";
  readonly reference: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
}

export type PublishedMaterialDiscoveryError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "discovery_not_found" }
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };

export type PublishedMaterialDiscoveryResult =
  | { readonly ok: true; readonly value: PublishedMaterialDiscoveryDto }
  | { readonly ok: false; readonly error: PublishedMaterialDiscoveryError };
