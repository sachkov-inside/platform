import { randomUUID } from "node:crypto";

import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import type { Subject, ContentAccess } from "../../../content-access/index.js";
import type { MaterialAssets } from "../../../assets/index.js";
import { materialId as checkedMaterialId } from "../../domain/material-identifiers.js";

export const MATERIAL_ASSET_DELIVERY = Symbol("MATERIAL_ASSET_DELIVERY");

export type DeliveredMaterialAsset =
  | Readonly<{
      body: Uint8Array;
      cacheScope: "public-immutable";
      contentDisposition?: string;
      contentLength: number;
      contentType: string;
      kind: "bytes";
    }>
  | Readonly<{
      cacheScope: "private-no-store";
      kind: "redirect";
      location: string;
    }>;

export type DeliverMaterialAssetResult =
  | { readonly ok: true; readonly value: DeliveredMaterialAsset }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "asset_not_found" }
        | { readonly code: "dependency_unavailable" };
    };

export interface MaterialAssetDelivery {
  deliver(input: {
    readonly assetId: string;
    readonly materialId: string;
    readonly preview: boolean;
    readonly subject: Subject;
    readonly variantWidth?: number;
  }): Promise<DeliverMaterialAssetResult>;
}

export function assembleMaterialAssetDelivery(dependencies: {
  readonly assets: Pick<MaterialAssets, "loadDelivery">;
  readonly contentAccess: ContentAccess;
  readonly objectStorage: ObjectStorage;
  readonly signedGetTtlSeconds: number;
}): MaterialAssetDelivery {
  const delivery: MaterialAssetDelivery = {
    async deliver(input) {
      const asset = await dependencies.assets.loadDelivery(input);
      if (asset === null) return notFound();
      const access = await dependencies.contentAccess.authorize({
        action: input.preview ? "preview" : asset.kind === "file" ? "download" : "read",
        correlationId: randomUUID(),
        enforcementPoint: asset.kind === "file" ? "download_delivery" : "asset_delivery",
        resource: { kind: "material", materialId: checkedMaterialId(asset.materialId) },
        subject: input.subject,
      });
      if (access.effect === "deny") {
        return access.reason === "dependency_unavailable"
          ? dependencyUnavailable()
          : notFound();
      }
      const contentDisposition = asset.kind === "file"
        ? attachmentDisposition(asset.filename)
        : undefined;
      if (access.reason === "public_resource") {
        if (asset.object.publicKey === null) return notFound();
        const stored = await dependencies.objectStorage.read("public", asset.object.publicKey);
        if (
          stored === null ||
          stored.contentLength !== asset.size ||
          stored.contentType !== asset.contentType
        ) {
          return dependencyUnavailable();
        }
        return {
          ok: true,
          value: {
            body: stored.body,
            cacheScope: "public-immutable",
            ...(contentDisposition === undefined ? {} : { contentDisposition }),
            contentLength: stored.contentLength,
            contentType: stored.contentType,
            kind: "bytes",
          },
        };
      }
      return {
        ok: true,
        value: {
          cacheScope: "private-no-store",
          kind: "redirect",
          location: await dependencies.objectStorage.signGet({
            ...(contentDisposition === undefined ? {} : { contentDisposition }),
            contentType: asset.contentType,
            key: asset.object.protectedKey,
            namespace: "protected",
            ttlSeconds: dependencies.signedGetTtlSeconds,
          }),
        },
      };
    },
  };
  return Object.freeze(delivery);
}

function attachmentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/gu, (character) =>
    `%${character.codePointAt(0)?.toString(16).toUpperCase() ?? ""}`,
  );
  return `attachment; filename="download"; filename*=UTF-8''${encoded}`;
}

function notFound(): DeliverMaterialAssetResult {
  return { error: { code: "asset_not_found" }, ok: false };
}

function dependencyUnavailable(): DeliverMaterialAssetResult {
  return { error: { code: "dependency_unavailable" }, ok: false };
}
