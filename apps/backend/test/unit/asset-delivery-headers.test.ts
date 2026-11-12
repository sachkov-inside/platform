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

  test("protected SVG bytes stay private and kept only for the delivery's bound (#2041)", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    );
    const delivered = {
      body: svg,
      cacheScope: "private-no-store",
      contentLength: svg.byteLength,
      contentType: "image/svg+xml",
      kind: "bytes",
    };

    const kept = await deliver({ ...delivered, keepSeconds: 7_199 });
    expect(kept.status).toBe(200);
    expect(kept.sent).toEqual(Buffer.from(svg));
    expect(Object.fromEntries(kept.headers)).toMatchObject({
      "cache-control": "private, max-age=7199, immutable",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "content-type": "image/svg+xml",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    });
    const preview = await deliver(delivered);
    expect(preview.headers.get("cache-control")).toBe("private, no-store");
    await expect(
      deliver({ ...delivered, contentDisposition: "attachment" }),
    ).rejects.toThrow(TypeError);
  });
});
