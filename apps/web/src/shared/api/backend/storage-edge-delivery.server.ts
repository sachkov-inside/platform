import "server-only";

/**
 * Protected bytes through the site edge (#1766). Caddy marks a request on its protected-delivery
 * route and strips the mark from client input; the BFF passes it to the API, which then answers
 * `204` with the signed storage address and the cache policy of the bytes in internal headers.
 * The BFF copies both back unchanged, Caddy fetches the object and removes them. Without the mark
 * (development, tests) the API keeps answering with a `302` to storage.
 */
const STORAGE_EDGE_REQUEST_HEADER = "x-inside-storage-delivery";
const STORAGE_EDGE_REQUEST_VALUE = "edge";
export const STORAGE_EDGE_RESPONSE_HEADERS = [
  "x-inside-storage-cache-control",
  "x-inside-storage-location",
] as const;

export function isStorageEdgeRequest(request: Request): boolean {
  return (
    request.headers.get(STORAGE_EDGE_REQUEST_HEADER) ===
    STORAGE_EDGE_REQUEST_VALUE
  );
}

export function storageEdgeRequestHeaders(
  viaStorageEdge: boolean,
): Readonly<Record<string, string>> {
  return viaStorageEdge
    ? { [STORAGE_EDGE_REQUEST_HEADER]: STORAGE_EDGE_REQUEST_VALUE }
    : {};
}
