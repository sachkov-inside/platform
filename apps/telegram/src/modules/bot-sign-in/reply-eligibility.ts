import { sql } from "kysely";
import type { SignInReplyEligibility } from "../outbound/sign-in-reply-eligibility.js";
import { linkedSignInProof } from "../identity-linking/sign-in-link.js";

/** Approval receipts expire and stop being due after linking; final success still needs a committed link. */
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
      (${sql.ref(reply.editMessageId)} is null and expires_at > ${now} and
        ((${sql.ref(reply.sourceKey)} = 'sign-in:' || request_ref::text and state = 'awaiting_approval')
          or (${sql.ref(reply.sourceKey)} = 'sign-in-approved:' || request_ref::text
            and state in ('approved', 'consumed')
            and not ${linkedSignInProof(database, "sign_in_requests.request_ref")})))
      or (${sql.ref(reply.editMessageId)} is not null and
        (state = 'denied' or (state = 'consumed' and ${linkedSignInProof(database, "sign_in_requests.request_ref")})))
    )`)})`;
