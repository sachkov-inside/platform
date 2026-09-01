import "server-only";

import { z } from "zod";

import {
  publishedMaterialProjectionSchema,
  toMaterialPreview,
} from "@/entities/material";
import {
  BackendConnectionError,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";

import type {
  LibraryDiscoveryKind,
  LibraryDiscoveryResult,
} from "../model/library-discovery-view";

const discoveryReferenceSchema = z
  .object({ id: z.string(), name: z.string(), slug: z.string() })
  .strict();
const discoveryNotFoundSchema = z
  .object({
    code: z.literal("discovery_not_found"),
    status: z.literal(404),
    title: z.literal("Discovery not found"),
    type: z.literal("urn:inside:problem:discovery-not-found"),
  })
  .strict();

export function mapLibraryDiscoveryResult(
  result: BackendTransportResult,
  discoveryKind: LibraryDiscoveryKind,
): LibraryDiscoveryResult {
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
      kind: z.literal(discoveryKind),
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
    return { discoveryKind, kind: "empty", reference };
  }
  return {
    discoveryKind,
    hasNext: parsed.data.hasNext,
    items: parsed.data.items.map(toMaterialPreview),
    kind: "ready",
    reference,
  };
}

function invalidContract(message: string, cause?: unknown): BackendConnectionError {
  return new BackendConnectionError("invalid-response", message, { cause });
}
