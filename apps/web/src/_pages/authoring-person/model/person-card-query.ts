import { queryOptions } from "@tanstack/react-query";

import { requestPersonCard } from "../api/person-card.browser";
import { personCardQueryKey } from "./person-card";

export function personCardQueryOptions(accountId: string) {
  return queryOptions({
    queryKey: personCardQueryKey(accountId),
    queryFn: ({ signal }) => requestPersonCard(accountId, signal),
  });
}
