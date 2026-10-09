import { sql } from "kysely";
import type { SignInReplyEligibility } from "../outbound/sign-in-reply-eligibility.js";
import { linkedSignInProof } from "../identity-linking/sign-in-link.js";

/** Prompts expire; denied edits survive expiry, and consumed edits wait for a committed link. */
export const signInReplyEligibility: SignInReplyEligibility = (
  database,
  now,
  reply,
) =>
  sql<boolean>`exists (${database
    .selectFrom("sign_in_requests")
    .select("request_ref")
    .where("request_ref", "=", sql<string>`${sql.ref(reply.requestRef)}`)
    .where(sql<boolean>`(
      (${sql.ref(reply.editMessageId)} is null and state = 'awaiting_approval' and expires_at > ${now})
      or (${sql.ref(reply.editMessageId)} is not null and
        (state = 'denied' or (state = 'consumed' and ${linkedSignInProof(database, "sign_in_requests.request_ref")})))
    )`)})`;
