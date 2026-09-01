import "server-only";

import { z } from "zod";

import type {
  LibraryDiscoveryKind,
  LibraryDiscoveryResult,
} from "../model/library-discovery-view";
import {
  publishedMaterialProjectionSchema,
  toMaterialPreview,
} from "@/entities/material";
import {
  BackendConnectionError,
  requestPublishedSeries,
  requestPublishedTopic,
  requestRelatedPublishedMaterials,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";

const discoveryReferenceSchema = z
  .object({ id: z.string(), name: z.string(), slug: z.string() })
  .strict();

const discoveryNotFoundSchema = z
  .object({
    type: z.literal("urn:inside:problem:discovery-not-found"),
    title: z.literal("Discovery not found"),
    status: z.literal(404),
    code: z.literal("discovery_not_found"),
  })
  .strict();

const requestByKind = {
  related: requestRelatedPublishedMaterials,
  series: requestPublishedSeries,
  topic: requestPublishedTopic,
} satisfies Record<
  LibraryDiscoveryKind,
  (
    slug: string,
    options?: { readonly accessToken?: string },
  ) => Promise<BackendTransportResult>
>;

export function getPublishedTopic(
  slug: string,
  accessToken?: string,
): Promise<LibraryDiscoveryResult> {
  return getLibraryDiscovery("topic", slug, accessToken);
}

export function getPublishedSeries(
  slug: string,
  accessToken?: string,
): Promise<LibraryDiscoveryResult> {
  return getLibraryDiscovery("series", slug, accessToken);
}

export function getRelatedMaterials(
  slug: string,
  accessToken?: string,
): Promise<LibraryDiscoveryResult> {
  return getLibraryDiscovery("related", slug, accessToken);
}

async function getLibraryDiscovery(
  kind: LibraryDiscoveryKind,
  slug: string,
  accessToken: string | undefined,
): Promise<LibraryDiscoveryResult> {
  let result: BackendTransportResult;
  try {
    result = await requestByKind[kind](slug, {
      ...(accessToken === undefined ? {} : { accessToken }),
    });
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unavailable" };
    }
    throw error;
  }

  if (!result.ok && result.response.status === 404) {
    if (!discoveryNotFoundSchema.safeParse(result.problem).success) {
      throw invalidContract("Discovery 404 response does not match the contract");
    }
    return { kind: "not-found" };
  }

  if (
    !result.ok &&
    dependencyUnavailableProblemSchema.safeParse(result.problem).success
  ) {
    return { kind: "unavailable" };
  }

  if (!result.ok) {
    throw new BackendConnectionError(
      "backend-error",
      `Library discovery request returned ${String(result.response.status)}`,
    );
  }

  const responseSchema = z
    .object({
      hasNext: z.boolean(),
      items: z.array(publishedMaterialProjectionSchema),
      kind: z.literal(kind),
      reference: discoveryReferenceSchema,
    })
    .strict();
  const parsed = responseSchema.safeParse(result.body);
  if (!parsed.success) {
    throw invalidContract(
      "Library discovery response does not match the contract",
      parsed.error,
    );
  }

  const reference = {
    name: parsed.data.reference.name,
    slug: parsed.data.reference.slug,
  };
  if (parsed.data.items.length === 0) {
    return { discoveryKind: kind, kind: "empty", reference };
  }
  return {
    discoveryKind: kind,
    hasNext: parsed.data.hasNext,
    items: parsed.data.items.map(toMaterialPreview),
    kind: "ready",
    reference,
  };
}

function invalidContract(message: string, cause?: unknown): BackendConnectionError {
  return new BackendConnectionError("invalid-response", message, { cause });
}
