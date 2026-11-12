import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, test } from "vitest";

import {
  AssetDeliveryCache,
  HttpCachePolicyInterceptor,
} from "../../src/infrastructure/http/http-cache-policy.js";

const deliveryHandler = () => undefined;
AssetDeliveryCache()(deliveryHandler);

function deliver(body: unknown) {
  const headers = new Map<string, string>();
  let status = 200;
  const response = {
    header(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return response;
    },
    status(code: number) {
      status = code;
      return response;
    },
  };
  const context = {
    getClass: () => deliveryHandler,
    getHandler: () => deliveryHandler,
    switchToHttp: () => ({
      getRequest: () => ({ headers: {} }),
      getResponse: () => response,
    }),
  };
  const next: CallHandler = { handle: () => of(body) };
  const interceptor = new HttpCachePolicyInterceptor(new Reflector());
  return firstValueFrom(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The interceptor reads only this HTTP subset.
    interceptor.intercept(context as unknown as ExecutionContext, next),
  ).then((sent) => ({ headers, sent, status }));
}

describe("Asset delivery headers", () => {
  test("delivered bytes carry their type, nosniff and a policy that runs no code", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    );
    const { headers, sent, status } = await deliver({
      body: svg,
      cacheScope: "public-immutable",
      contentLength: svg.byteLength,
      contentType: "image/svg+xml",
      kind: "bytes",
    });

    expect(status).toBe(200);
    expect(sent).toEqual(Buffer.from(svg));
    expect(Object.fromEntries(headers)).toMatchObject({
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(svg.byteLength),
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "content-type": "image/svg+xml",
      "x-content-type-options": "nosniff",
    });
  });
});
