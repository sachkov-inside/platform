import { randomUUID } from "node:crypto";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
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
            truncated: result.value.nameSearch === "truncated",
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
        // Every authoring search text (trimmed, 1–160 characters, at most five hits) is also a
        // valid people search, so no valid request reaches this branch: a refusal means the two
        // bounds drifted apart. That is a defect to record, not an empty answer to show, so the
        // group is unavailable and the record carries the same correlation ID.
        case "invalid_request":
          return dependencyFailure(
            { module: "authoring-search", operation: "searchAuthoring" },
            new RangeError("People Directory refused an authoring search text"),
            {
              ok: false,
              error: { code: "internal_error", correlationId: randomUUID() },
            } as const,
          );
      }
    },
  };
}
