import { randomUUID } from "node:crypto";

import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ContentAccess, Subject } from "../../../content-access/index.js";
import {
  attachmentDisposition,
  readPublicObject,
  signedDeliveryTtlSeconds,
} from "../../shared/protected-delivery.js";
import type {
  ProductArtifacts,
  ReaderProductArtifact,
} from "../../facets/product-artifacts/product-artifacts.js";

export const PRODUCT_ARTIFACT_DELIVERY = Symbol("PRODUCT_ARTIFACT_DELIVERY");

/** Matches the batch size the shared ContentAccess availability read accepts. */
const AVAILABILITY_BATCH_SIZE = 100;

export type PublicProductArtifactContent =
  | Readonly<{
      contentType: string;
      filename: string;
      kind: "file";
      size: number;
    }>
  | Readonly<{ externalUrl: string | null; kind: "link" }>;

export interface PublicProductArtifactDto {
  readonly artifactId: string;
  readonly availability: "available" | "locked";
  readonly content: PublicProductArtifactContent;
  readonly purpose: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly version: number;
}

export type DeliveredProductArtifact =
  | Readonly<{
      body: Uint8Array;
      cacheScope: "public-immutable";
      contentDisposition: string;
      contentLength: number;
      contentType: string;
      kind: "bytes";
    }>
  | Readonly<{
      cacheScope: "private-no-store";
      kind: "redirect";
      location: string;
    }>;

export type ProductArtifactDeliveryResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{
      ok: false;
      error:
        | { readonly code: "artifact_not_found" }
        | { readonly code: "dependency_unavailable" };
    }>;

export interface ProductArtifactDelivery {
  read(query: {
    readonly productId: string;
    readonly subject: Subject;
  }): Promise<
    ProductArtifactDeliveryResult<readonly PublicProductArtifactDto[]>
  >;
  deliver(query: {
    readonly artifactId: string;
    readonly productId: string;
    readonly preview: boolean;
    readonly subject: Subject;
    readonly version: number;
  }): Promise<ProductArtifactDeliveryResult<DeliveredProductArtifact>>;
}

export function assembleProductArtifactDelivery(dependencies: {
  readonly artifacts: Pick<
    ProductArtifacts,
    "loadFileDelivery" | "loadForReader"
  >;
  readonly contentAccess: ContentAccess;
  readonly objectStorage: ObjectStorage;
  readonly signedGetTtlSeconds: number;
}): ProductArtifactDelivery {
  const delivery: ProductArtifactDelivery = {
    async read(query) {
      const loaded = await dependencies.artifacts.loadForReader(
        query.productId,
      );
      if (!loaded.ok) {
        return loaded.error.code === "product_not_found"
          ? notFound()
          : dependencyUnavailable();
      }
      if (loaded.value.length === 0) return { ok: true, value: [] };
      const states = new Map<string, "available" | "locked" | "unavailable">();
      // The shared availability batch is bounded, so a long artifact section is
      // decided in whole batches instead of being silently cut short.
      for (const batch of inBatches(loaded.value, AVAILABILITY_BATCH_SIZE)) {
        let availability;
        try {
          availability = await dependencies.contentAccess.checkAvailabilityMany(
            {
              correlationId: randomUUID(),
              enforcementPoint: "product_artifact_read",
              operations: batch.map((artifact) => ({
                action: "download" as const,
                itemId: artifact.artifactId,
                resource: {
                  artifactId: artifact.artifactId,
                  kind: "productArtifact" as const,
                },
              })),
              subject: query.subject,
            },
          );
        } catch (error) {
          return dependencyFailure(
            { module: "materials", operation: "read" },
            error,
            dependencyUnavailable(),
          );
        }
        if (!availability.ok) return dependencyUnavailable();
        for (const item of availability.items) {
          states.set(item.itemId, item.availability);
        }
      }
      return {
        ok: true,
        value: loaded.value.flatMap((artifact) => {
          const state = states.get(artifact.artifactId) ?? "unavailable";
          return state === "unavailable"
            ? []
            : [projectPublicArtifact(artifact, state === "available")];
        }),
      };
    },

    async deliver(query) {
      let decision;
      try {
        decision = await dependencies.contentAccess.authorize({
          action: query.preview ? "preview" : "download",
          correlationId: randomUUID(),
          enforcementPoint: "product_artifact_delivery",
          resource: { artifactId: query.artifactId, kind: "productArtifact" },
          subject: query.subject,
        });
      } catch (error) {
        return dependencyFailure(
          { module: "materials", operation: "deliver" },
          error,
          dependencyUnavailable(),
        );
      }
      if (decision.effect === "deny") {
        return decision.reason === "dependency_unavailable"
          ? dependencyUnavailable()
          : notFound();
      }
      if (decision.checkedContentVersion !== query.version) return notFound();

      const loaded = await dependencies.artifacts.loadFileDelivery({
        artifactId: query.artifactId,
        productId: query.productId,
      });
      if (!loaded.ok) return dependencyUnavailable();
      const file = loaded.value;
      if (file === null) return notFound();
      const contentDisposition = attachmentDisposition(file.filename);
      if (decision.reason === "public_resource") {
        const stored = await readPublicObject(dependencies.objectStorage, {
          contentType: file.contentType,
          key: file.object.publicKey,
          size: file.size,
        });
        if (stored.kind === "mismatch") return notFound();
        if (stored.kind === "unavailable") return dependencyUnavailable();
        return {
          ok: true,
          value: {
            body: stored.object.body,
            cacheScope: "public-immutable",
            contentDisposition,
            contentLength: stored.object.contentLength,
            contentType: stored.object.contentType,
            kind: "bytes",
          },
        };
      }
      const ttlSeconds = signedDeliveryTtlSeconds(
        dependencies.signedGetTtlSeconds,
        decision.reason === "active_membership"
          ? decision.validUntil
          : undefined,
      );
      if (ttlSeconds === null) return notFound();
      try {
        return {
          ok: true,
          value: {
            cacheScope: "private-no-store",
            kind: "redirect",
            location: await dependencies.objectStorage.signGet({
              contentDisposition,
              contentType: file.contentType,
              key: file.object.protectedKey,
              namespace: "protected",
              ttlSeconds,
            }),
          },
        };
      } catch (error) {
        return dependencyFailure(
          { module: "materials", operation: "deliver" },
          error,
          dependencyUnavailable(),
        );
      }
    },
  };
  return Object.freeze(delivery);
}

function* inBatches<Value>(
  values: readonly Value[],
  size: number,
): Generator<readonly Value[]> {
  for (let start = 0; start < values.length; start += size) {
    yield values.slice(start, start + size);
  }
}

function projectPublicArtifact(
  artifact: ReaderProductArtifact,
  available: boolean,
): PublicProductArtifactDto {
  return {
    artifactId: artifact.artifactId,
    availability: available ? "available" : "locked",
    content:
      artifact.content.kind === "link"
        ? {
            externalUrl: available ? artifact.content.externalUrl : null,
            kind: "link",
          }
        : {
            contentType: artifact.content.contentType,
            filename: artifact.content.filename,
            kind: "file",
            size: artifact.content.size,
          },
    purpose: artifact.purpose,
    title: artifact.title,
    updatedAt: artifact.updatedAt,
    version: artifact.version,
  };
}

function notFound<Value>(): ProductArtifactDeliveryResult<Value> {
  return { error: { code: "artifact_not_found" }, ok: false };
}

function dependencyUnavailable<Value>(): ProductArtifactDeliveryResult<Value> {
  return { error: { code: "dependency_unavailable" }, ok: false };
}
