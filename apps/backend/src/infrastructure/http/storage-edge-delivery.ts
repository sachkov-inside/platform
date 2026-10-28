import { ApiNoContentResponse } from "@nestjs/swagger";

/**
 * Protected bytes through the site edge (#1766). Caddy sets the request marker only on its
 * protected-delivery route and strips it from client input. With the marker the API makes the same
 * access decision and answers `204` instead of a browser redirect: the signed storage address and
 * the cache policy for the delivered bytes travel in internal headers, Caddy fetches the object
 * itself and removes both headers. Without the marker (development, tests, direct callers) the
 * answer stays a `302`. The marker is not an access boundary: it changes only where an address,
 * already signed for an allowed reader, is sent.
 */
export const STORAGE_EDGE_REQUEST_HEADER = "x-inside-storage-delivery";
export const STORAGE_EDGE_REQUEST_VALUE = "edge";
export const STORAGE_EDGE_LOCATION_HEADER = "x-inside-storage-location";
export const STORAGE_EDGE_CACHE_CONTROL_HEADER =
  "x-inside-storage-cache-control";

/** OpenAPI description of the edge answer shared by every protected delivery operation. */
export const ApiStorageEdgeResponse = () =>
  ApiNoContentResponse({
    description:
      "Protected object for the site edge: only with the edge request marker",
    headers: {
      [STORAGE_EDGE_LOCATION_HEADER]: {
        schema: { format: "uri", type: "string" },
      },
      [STORAGE_EDGE_CACHE_CONTROL_HEADER]: { schema: { type: "string" } },
    },
  });
