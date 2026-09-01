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
      const access = await dependencies.contentAccess.authorize({
        action: input.preview ? "preview" : input.variantWidth === undefined ? "download" : "read",
        correlationId: randomUUID(),
        enforcementPoint: input.variantWidth === undefined ? "download_delivery" : "asset_delivery",
        resource: { assetId: input.assetId, kind: "asset" },
        subject: input.subject,
      });
      if (access.effect === "deny") {
        return access.reason === "dependency_unavailable"
          ? dependencyUnavailable()
          : notFound();
      }
      let loaded: Awaited<ReturnType<MaterialAssets["loadDelivery"]>>;
      try {
        loaded = await dependencies.assets.loadDelivery(input);
      } catch {
        return dependencyUnavailable();
      }
      if (!loaded.ok) return dependencyUnavailable();
      const asset = loaded.value;
      if (asset === null || checkedMaterialId(asset.materialId) !== checkedMaterialId(input.materialId)) {
        return notFound();
      }
      const contentDisposition = asset.kind === "file"
        ? attachmentDisposition(asset.filename)
        : undefined;
      if (access.reason === "public_resource") {
        if (asset.object.publicKey === null) return notFound();
        let stored;
        try {
          stored = await dependencies.objectStorage.read("public", asset.object.publicKey);
        } catch {
          return dependencyUnavailable();
        }
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
      const ttlSeconds = signedGetTtlSeconds(
        dependencies.signedGetTtlSeconds,
        access.reason === "active_membership" ? access.validUntil : undefined,
      );
      if (ttlSeconds === null) return notFound();
      let location: string;
      try {
        location = await dependencies.objectStorage.signGet({
          ...(contentDisposition === undefined ? {} : { contentDisposition }),
          contentType: asset.contentType,
          key: asset.object.protectedKey,
          namespace: "protected",
          ttlSeconds,
        });
      } catch {
        return dependencyUnavailable();
      }
      return {
        ok: true,
        value: {
          cacheScope: "private-no-store",
          kind: "redirect",
          location,
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

function signedGetTtlSeconds(
  configuredTtlSeconds: number,
  validUntil: string | undefined,
): number | null {
  if (validUntil === undefined) return configuredTtlSeconds;
  const remainingWholeSeconds = Math.floor(
    (Date.parse(validUntil) - Date.now()) / 1_000,
  );
  const boundedTtlSeconds = Math.min(
    configuredTtlSeconds,
    remainingWholeSeconds - 1,
  );
  return boundedTtlSeconds >= 1 ? boundedTtlSeconds : null;
}
