import "server-only";

import { STORAGE_EDGE_RESPONSE_HEADERS } from "./storage-edge-delivery.server";

export function copyBackendResponse(response: Response): Response {
  const headers = new Headers();
  for (const name of [
    "cache-control",
    "content-disposition",
    "content-length",
    "content-type",
    "location",
    "x-content-type-options",
    "x-robots-tag",
    ...STORAGE_EDGE_RESPONSE_HEADERS,
  ]) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(response.body, { headers, status: response.status });
}

export function backendProxyProblem(
  status: number,
  code: string,
  title: string,
): Response {
  return Response.json(
    { code, status, title, type: `urn:inside:problem:${code}` },
    { headers: { "cache-control": "private, no-store" }, status },
  );
}
