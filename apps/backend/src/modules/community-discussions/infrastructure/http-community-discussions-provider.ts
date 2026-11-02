import {
  communityDiscussionsErrorSchema,
  communityDiscussionsSuccessSchema,
  type CommunityDiscussionsRequest,
  type CommunityDiscussionsSuccess,
} from "@inside/contracts/community-discussions";
import { dependencyFailure } from "../../../infrastructure/observability/index.js";
import {
  discussionsFailure,
  type CommunityDiscussionsResult,
} from "../community-discussions-contract.js";

const PROVIDER_REQUEST_TIMEOUT_MS = 5_000;
const errorStatuses = {
  unauthorized: 401,
  forbidden: 403,
  authorization_unavailable: 503,
  malformed: 400,
  not_found: 404,
  operation_conflict: 409,
} as const;

export class HttpCommunityDiscussionsProvider {
  constructor(
    private readonly config:
      { readonly endpoint: string; readonly secret: string } | undefined,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async execute(
    request: CommunityDiscussionsRequest,
  ): Promise<CommunityDiscussionsResult> {
    if (this.config === undefined)
      return discussionsFailure("provider_unavailable");
    try {
      const response = await this.fetcher(this.config.endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${this.config.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      });
      const body: unknown = await response.json();
      const error = communityDiscussionsErrorSchema.safeParse(body);
      if (error.success)
        return response.status === errorStatuses[error.data.status]
          ? discussionsFailure(error.data.status)
          : discussionsFailure("provider_invalid_response");
      const parsed = communityDiscussionsSuccessSchema.safeParse(body);
      if (
        !parsed.success ||
        response.status !== 200 ||
        parsed.data.operation !== request.operation ||
        parsed.data.requestId !== request.requestId ||
        !matchesDiscussion(request, parsed.data)
      )
        return discussionsFailure("provider_invalid_response");
      return { ok: true, value: parsed.data };
    } catch (error) {
      // A timed-out mark may already have committed; only the caller can retry its original request ID.
      return dependencyFailure(
        { module: "community-discussions", operation: "execute" },
        error,
        discussionsFailure("provider_unavailable"),
      );
    }
  }
}

function matchesDiscussion(
  request: CommunityDiscussionsRequest,
  response: CommunityDiscussionsSuccess,
): boolean {
  if (request.operation === "discussions.list")
    return (
      response.operation === "discussions.list" &&
      response.items.length <= request.limit
    );
  if (
    !("discussion" in response) ||
    response.discussion.discussionId.toLowerCase() !==
      request.discussionId.toLowerCase()
  )
    return false;
  return (
    request.operation !== "discussions.mark" ||
    (response.discussion.status === request.status &&
      JSON.stringify(response.discussion.materialUrls) ===
        JSON.stringify(request.materialUrls))
  );
}
