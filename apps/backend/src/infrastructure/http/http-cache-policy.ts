import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply } from "fastify";
import type { FastifyRequest } from "fastify";
import { map, type Observable, tap } from "rxjs";

const CACHE_POLICY_METADATA = Symbol("http-cache-policy");

type HttpCachePolicy =
  | "private-no-store"
  | "asset-delivery"
  | "public-catalog"
  | "viewer-aware-catalog"
  | "published-material-response";

const cacheControlByPolicy = {
  "asset-delivery": "private, no-store",
  "private-no-store": "private, no-store",
  "public-catalog": "public, max-age=30, stale-while-revalidate=60",
} as const;

export const PrivateNoStore = () =>
  SetMetadata(CACHE_POLICY_METADATA, "private-no-store" satisfies HttpCachePolicy);

export const PublicCatalogCache = () =>
  SetMetadata(CACHE_POLICY_METADATA, "public-catalog" satisfies HttpCachePolicy);

export const ViewerAwareCatalogCache = () =>
  SetMetadata(
    CACHE_POLICY_METADATA,
    "viewer-aware-catalog" satisfies HttpCachePolicy,
  );

export const PublishedMaterialCache = () =>
  SetMetadata(
    CACHE_POLICY_METADATA,
    "published-material-response" satisfies HttpCachePolicy,
  );

export const AssetDeliveryCache = () =>
  SetMetadata(
    CACHE_POLICY_METADATA,
    "asset-delivery" satisfies HttpCachePolicy,
  );

@Injectable()
export class HttpCachePolicyInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const policy = this.reflector.getAllAndOverride<HttpCachePolicy>(
      CACHE_POLICY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (policy === undefined) {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<FastifyReply>();
    if (policy === "asset-delivery") {
      return next.handle().pipe(
        map((body: unknown) => sendAssetDelivery(response, body)),
      );
    }
    return next.handle().pipe(
      tap((body: unknown) => {
        response.header(
          "Cache-Control",
          resolveCacheControl(policy, body, context),
        );
      }),
    );
  }
}

function sendAssetDelivery(
  response: FastifyReply,
  body: unknown,
): Buffer | undefined {
  if (!isAssetDelivery(body)) {
    throw new TypeError("Asset delivery controller returned an invalid response");
  }
  response.header(
    "Cache-Control",
    body.cacheScope === "public-immutable"
      ? "public, max-age=31536000, immutable"
      : cacheControlByPolicy["private-no-store"],
  );
  response.header("X-Content-Type-Options", "nosniff");
  if (body.kind === "redirect") {
    response.status(302);
    response.header("Location", body.location);
    return undefined;
  }
  response.header("Content-Type", body.contentType);
  response.header("Content-Length", String(body.contentLength));
  if (body.contentDisposition !== undefined) {
    response.header("Content-Disposition", body.contentDisposition);
  }
  return Buffer.from(body.body);
}

function isAssetDelivery(value: unknown): value is
  | Readonly<{
      body: Uint8Array;
      cacheScope: "public-immutable";
      contentDisposition?: string;
      contentLength: number;
      contentType: string;
      kind: "bytes";
    }>
  | Readonly<{
      cacheScope: "private-no-store";
      kind: "redirect";
      location: string;
    }> {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  if (value.kind === "redirect") {
    return "cacheScope" in value && value.cacheScope === "private-no-store" &&
      "location" in value && typeof value.location === "string";
  }
  return value.kind === "bytes" && "cacheScope" in value &&
    value.cacheScope === "public-immutable" && "body" in value &&
    value.body instanceof Uint8Array && "contentLength" in value &&
    typeof value.contentLength === "number" && "contentType" in value &&
    typeof value.contentType === "string";
}

function resolveCacheControl(
  policy: HttpCachePolicy,
  body: unknown,
  context: ExecutionContext,
): string {
  if (policy === "viewer-aware-catalog") {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    return request.headers.authorization === undefined
      ? cacheControlByPolicy["public-catalog"]
      : cacheControlByPolicy["private-no-store"];
  }
  if (policy !== "published-material-response") {
    return cacheControlByPolicy[policy];
  }

  return hasPublicCacheScope(body)
    ? "public, max-age=0, must-revalidate"
    : cacheControlByPolicy["private-no-store"];
}

function hasPublicCacheScope(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "cacheScope" in value &&
    value.cacheScope === "public"
  );
}
