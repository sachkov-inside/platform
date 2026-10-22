import { vi } from "vitest";

export const testSiteOrigin = "https://inside.example.test";

type RouteHandler = (request: Request) => Promise<Response> | Response;
type RouteModule = Partial<Record<string, RouteHandler>>;

/**
 * Connects a browser adapter to the Route Handlers of `app/`: `fetch` from the adapter becomes the
 * same-origin request that Next.js hands to the exported method of the route at that path. A
 * pair test therefore crosses the operation's literal path, method, JSON body and handler once.
 */
export function routeBrowserMutations(
  routes: Readonly<Partial<Record<string, RouteModule>>>,
  origin = testSiteOrigin,
) {
  const requests: Request[] = [];
  const statuses: number[] = [];
  const fetch = vi.fn(
    async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const target = new URL(url, testSiteOrigin);
      const headers = new Headers(init?.headers);
      headers.set("origin", origin);
      const request = new Request(target, { ...init, headers });
      requests.push(request.clone());
      const route = routes[target.pathname];
      const handler = route?.[request.method];
      const response =
        handler === undefined
          ? new Response(null, { status: 404 })
          : await handler(request);
      statuses.push(response.status);
      return response;
    },
  );
  vi.stubGlobal("fetch", fetch);
  return { fetch, requests, statuses };
}
