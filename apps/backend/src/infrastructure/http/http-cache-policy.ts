import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply } from "fastify";
import { type Observable, tap } from "rxjs";

const CACHE_POLICY_METADATA = Symbol("http-cache-policy");

type HttpCachePolicy =
  | "private-no-store"
  | "public-catalog"
  | "published-material-response";

const cacheControlByPolicy = {
  "private-no-store": "private, no-store",
  "public-catalog": "public, max-age=30, stale-while-revalidate=60",
} as const;

export const PrivateNoStore = () =>
  SetMetadata(CACHE_POLICY_METADATA, "private-no-store" satisfies HttpCachePolicy);

export const PublicCatalogCache = () =>
  SetMetadata(CACHE_POLICY_METADATA, "public-catalog" satisfies HttpCachePolicy);

export const PublishedMaterialCache = () =>
  SetMetadata(
    CACHE_POLICY_METADATA,
    "published-material-response" satisfies HttpCachePolicy,
  );

@Injectable()
export class HttpCachePolicyInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const policy = this.reflector.getAllAndOverride<HttpCachePolicy>(
      CACHE_POLICY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (policy === undefined) {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      tap((body: unknown) => {
        response.header("Cache-Control", resolveCacheControl(policy, body));
      }),
    );
  }
}

function resolveCacheControl(policy: HttpCachePolicy, body: unknown): string {
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
