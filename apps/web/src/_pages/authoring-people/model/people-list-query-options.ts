import { queryOptions } from "@tanstack/react-query";

import { requestPeopleList } from "../api/people-list.browser";
import { peopleListQueryKey, type PeopleListQuery } from "./people-list";

export function peopleListQueryOptions(query: PeopleListQuery) {
  return queryOptions({
    queryKey: peopleListQueryKey(query),
    queryFn: ({ signal }) => requestPeopleList(query, signal),
  });
}
