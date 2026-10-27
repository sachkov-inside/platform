import { randomUUID } from "node:crypto";

import type { PeopleDirectory } from "../../../people-directory/index.js";
import type { AuthoringSearchGroup } from "../../ports/authoring-search-group.js";

/** The People group; the People Directory decides `billing:manage`. */
export function assemblePeopleSearchGroup(
  directory: Pick<PeopleDirectory, "searchPeople">,
): AuthoringSearchGroup {
  return {
    kind: "people",
    search: async (request) => {
      const result = await directory.searchPeople(request.actor, {
        query: request.query,
        limit: request.limit,
      });
      if (result.ok)
        return {
          ok: true,
          value: {
            kind: "people",
            state: "ready",
            items: result.value.items.map((person) => ({
              accountId: person.accountId,
              displayName: person.displayName,
              username: person.username,
              email: person.email,
              contactsState: person.contactsState,
            })),
            partial: result.value.nameSearch === "unavailable",
          },
        };
      switch (result.error.code) {
        case "forbidden":
          return { ok: false, error: { code: "forbidden" } };
        case "dependency_unavailable":
          return {
            ok: false,
            error: { code: "dependency_unavailable", retryable: true },
          };
        // The search text and limit are already within the directory's bounds: a refusal of
        // them is a defect of this adapter, not of the request.
        case "invalid_request":
          return {
            ok: false,
            error: { code: "internal_error", correlationId: randomUUID() },
          };
      }
    },
  };
}
