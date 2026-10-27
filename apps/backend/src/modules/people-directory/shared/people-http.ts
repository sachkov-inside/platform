import { z } from "zod";

import { problemException } from "../../../infrastructure/http/problem-details.js";
import type { PeopleDirectoryError } from "./people-composition.js";

/** One person on the wire: every field named, so a new fact never leaks through a spread. */
export const personIdentityHttpSchema = z
  .object({
    accountId: z.uuid(),
    displayName: z.string().nullable(),
    username: z.string().nullable(),
    email: z.string().nullable(),
    contactsState: z.enum(["complete", "partial"]),
  })
  .strict();

/** The Problem Details of a people directory refusal or failure; no answer names a person. */
export function peopleDirectoryProblem(error: PeopleDirectoryError): Error {
  switch (error.code) {
    case "invalid_request":
      return problemException(400, error.code, "People request is malformed");
    case "forbidden":
      return problemException(
        403,
        error.code,
        "The account may not read people",
      );
    case "not_found":
      return problemException(404, error.code, "Person not found");
    case "dependency_unavailable":
      return problemException(
        503,
        error.code,
        "People are temporarily unavailable",
      );
  }
}
