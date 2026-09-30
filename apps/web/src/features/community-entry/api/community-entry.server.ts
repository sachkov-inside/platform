import "server-only";

import { readAuthenticatedBilling } from "@/entities/subscription.server";
import { requestCurrentCommunityEntry } from "@/shared/api/backend/index.server";

import { communityEntrySchema } from "../model/community-entry";

export function handleCurrentCommunityEntry(): Promise<Response> {
  return readAuthenticatedBilling(
    (accessToken) => requestCurrentCommunityEntry(accessToken),
    communityEntrySchema,
  );
}
