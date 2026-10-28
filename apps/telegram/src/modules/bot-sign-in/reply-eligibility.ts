import { sql } from "kysely";
import type { SignInReplyEligibility } from "../outbound/sign-in-reply-eligibility.js";

/** A decision receipt follows the committed approval, independently of browser completion. */
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
        state = 'awaiting_approval')
      or (${sql.ref(reply.editMessageId)} is not null and
        state in ('approved', 'consumed', 'denied'))
    )`)})`;
