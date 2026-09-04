import "server-only";

import type { ContentCoverOwnerKind } from "@/shared/content-cover-owner";
import { readBackendBaseUrl } from "./transport-core.server";

const CONTENT_COVER_DELIVERY_TIMEOUT_MS = 10_000;
const CONTENT_COVER_REMOVAL_TIMEOUT_MS = 10_000;
const CONTENT_COVER_UPLOAD_TIMEOUT_MS = 60_000;

export function requestContentCoverDelivery(input: {
  readonly coverId: string;
  readonly signal: AbortSignal;
  readonly width: string;
}): Promise<Response> {
  return fetch(
    `${readBackendBaseUrl()}/content-covers/${encodeURIComponent(input.coverId)}/${encodeURIComponent(input.width)}`,
    {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.any([
        input.signal,
        AbortSignal.timeout(CONTENT_COVER_DELIVERY_TIMEOUT_MS),
      ]),
    },
  );
}

export function requestContentCoverUpload(input: {
  readonly accessToken: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly ownerId: string;
  readonly ownerKind: ContentCoverOwnerKind;
  readonly signal: AbortSignal;
}): Promise<Response> {
  return fetch(contentCoverAuthoringUrl(input.ownerKind, input.ownerId), {
    body: input.body,
    cache: "no-store",
    duplex: "half",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": input.contentType,
    },
    method: "PUT",
    signal: AbortSignal.any([
      input.signal,
      AbortSignal.timeout(CONTENT_COVER_UPLOAD_TIMEOUT_MS),
    ]),
  } as RequestInit & { duplex: "half" });
}

export function requestContentCoverRemoval(input: {
  readonly accessToken: string;
  readonly expectedCoverId: string | null;
  readonly ownerId: string;
  readonly ownerKind: ContentCoverOwnerKind;
  readonly signal: AbortSignal;
}): Promise<Response> {
  return fetch(contentCoverAuthoringUrl(input.ownerKind, input.ownerId), {
    body: JSON.stringify({ expectedCoverId: input.expectedCoverId }),
    cache: "no-store",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    method: "DELETE",
    signal: AbortSignal.any([
      input.signal,
      AbortSignal.timeout(CONTENT_COVER_REMOVAL_TIMEOUT_MS),
    ]),
  });
}

function contentCoverAuthoringUrl(
  ownerKind: ContentCoverOwnerKind,
  ownerId: string,
): string {
  return `${readBackendBaseUrl()}/authoring/content-covers/${ownerKind}/${encodeURIComponent(ownerId)}`;
}
