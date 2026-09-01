export type MaterialAssetKind = "file" | "image";
export type MaterialAssetState = "failed" | "pending" | "processing" | "ready";

export interface MaterialAssetDto {
  readonly assetId: string;
  readonly contentType: string;
  readonly filename: string;
  readonly height?: number;
  readonly kind: MaterialAssetKind;
  readonly size: number;
  readonly state: "ready";
  readonly variants?: readonly {
    readonly height: number;
    readonly width: number;
  }[];
  readonly width?: number;
}

export type UploadMaterialAssetError =
  | {
      readonly code:
        | "checksum_mismatch"
        | "executable_content"
        | "image_decode_failed"
        | "image_too_large"
        | "mime_mismatch"
        | "size_mismatch"
        | "unsupported_file_type"
        | "unsupported_image_type";
    }
  | { readonly code: "idempotency_key_reused" }
  | { readonly code: "invalid_upload" }
  | { readonly code: "dependency_unavailable" }
  | { readonly code: "upload_in_progress" };

export type UploadMaterialAssetResult =
  | { readonly ok: true; readonly value: MaterialAssetDto }
  | { readonly ok: false; readonly error: UploadMaterialAssetError };

export interface MaterialAssetReference {
  readonly assetId: string;
  readonly kind: MaterialAssetKind;
}

export interface MaterialAssetReferenceIssue {
  readonly assetId: string;
  readonly code:
    | "asset_kind_mismatch"
    | "asset_not_found"
    | "asset_not_ready"
    | "asset_wrong_material";
}

export interface MaterialAssetAccessFacts {
  readonly assetId: string;
  readonly kind: MaterialAssetKind;
  readonly materialId: string;
}

export type MaterialAssetQueryResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{
      ok: false;
      error: { code: "dependency_unavailable"; retryable: true };
    }>;

export interface MaterialAssetDelivery {
  readonly assetId: string;
  readonly contentType: string;
  readonly filename: string;
  readonly kind: MaterialAssetKind;
  readonly materialId: string;
  readonly object: Readonly<{
    readonly protectedKey: string;
    readonly publicKey: string | null;
  }>;
  readonly size: number;
}

export type MaterialAssetPresentation =
  | Readonly<{
      assetId: string;
      height: number;
      kind: "image";
      variants: readonly { readonly height: number; readonly width: number }[];
      width: number;
    }>
  | Readonly<{
      assetId: string;
      contentType: string;
      filename: string;
      kind: "file";
      size: number;
    }>;

export interface MaterialAssets {
  upload(input: {
    readonly actor: string;
    readonly body: Uint8Array;
    readonly declaredContentType: string;
    readonly declaredSize: number;
    readonly expectedChecksumSha256: string;
    readonly filename: string;
    readonly idempotencyKey: string;
    readonly kind: MaterialAssetKind;
    readonly materialId: string;
  }): Promise<UploadMaterialAssetResult>;
  inspectReferences(
    materialId: string,
    references: readonly MaterialAssetReference[],
  ): Promise<MaterialAssetQueryResult<readonly MaterialAssetReferenceIssue[]>>;
  markUnreferenced(input: {
    readonly materialId: string;
    readonly orphanedAt: Date;
    readonly referencedAssetIds: readonly string[];
  }): Promise<MaterialAssetQueryResult<void>>;
  loadAccessFacts(
    assetIds: readonly string[],
  ): Promise<MaterialAssetQueryResult<readonly MaterialAssetAccessFacts[]>>;
  loadPresentations(
    materialId: string,
    assetIds: readonly string[],
  ): Promise<MaterialAssetQueryResult<readonly MaterialAssetPresentation[]>>;
  loadDelivery(input: {
    readonly assetId: string;
    readonly materialId: string;
    readonly variantWidth?: number;
  }): Promise<MaterialAssetQueryResult<MaterialAssetDelivery | null>>;
  cleanupOrphans(input: {
    readonly graceMs: number;
    readonly isReferenced: (input: {
      readonly assetId: string;
      readonly materialId: string;
    }) => Promise<boolean>;
    readonly now?: Date;
  }): Promise<MaterialAssetQueryResult<Readonly<{ cleaned: number; retained: number }>>>;
}
