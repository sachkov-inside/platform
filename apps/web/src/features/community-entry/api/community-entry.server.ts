import "server-only";
import { z } from "zod";

import {
  billingFailureResponse,
  readAuthenticatedBilling,
} from "@/entities/subscription.server";
import { requestCurrentCommunityEntry } from "@/shared/api/backend/index.server";

import { communityEntrySchema } from "../model/community-entry";

export function handleCurrentCommunityEntry(
  request?: Request,
): Promise<Response> {
  const value =
    request === undefined
      ? null
      : new URL(request.url).searchParams.get("productId");
  const parsed = value === null ? undefined : z.uuid().safeParse(value);
  if (parsed !== undefined && !parsed.success)
    return Promise.resolve(billingFailureResponse("invalid_request", 400));
  const productId = parsed?.data;
  return readAuthenticatedBilling(
    (accessToken) => requestCurrentCommunityEntry(accessToken, productId),
    communityEntrySchema,
  );
}
