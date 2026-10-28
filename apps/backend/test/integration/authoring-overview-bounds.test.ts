import {
  fixedTestInstant,
  registerFixedClock,
} from "../support/fixed-clock.js";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { COMMUNITY_PROBLEM_ACCOUNTS_LIMIT } from "../../src/modules/telegram-membership/features/list-community-problem-accounts/list-community-problem-accounts.js";
import { startPeopleApi, type PeopleApi } from "./setup/people-api.js";

registerFixedClock();

const instant = fixedTestInstant();
type Json = Record<string, unknown>;

/**
 * A problem set beyond its owner's bound is refused, never cut (#1719): the people list answers
 * 503 and the Overview's item is unavailable; at the bound both answer.
 */
describe("Telegram problem sets at their bound", () => {
  let api: PeopleApi;
  let owner: Record<string, string>;
  /** `count` Accounts whose only, latest community operation was rejected. */
  const rejected = (count: number) =>
    api.database.prisma.$executeRaw`
      INSERT INTO telegram_membership.community_operations (
        operation_id, account_id, entitlement_revision, purpose, link_ref, link_revision,
        account_ref, identity_ref, access, command, payload_digest, issued_at, delivery,
        next_attempt_at, created_at, updated_at)
      SELECT gen_random_uuid(), gen_random_uuid(), 1, 'apply', gen_random_uuid(), 1,
        'principal', 'identity', '{}'::jsonb, '{}'::jsonb, repeat('c', 64), ${new Date(instant)},
        'rejected', ${new Date(instant)}, ${new Date(instant)}, ${new Date(instant)}
      FROM generate_series(1, ${count})`;

  beforeAll(async () => {
    api = await startPeopleApi();
    owner = (await api.signedIn("billing:manage")).headers;
    await rejected(COMMUNITY_PROBLEM_ACCOUNTS_LIMIT);
  });

  afterAll(async () => {
    await api.close();
  });

  test("at the bound the set answers; one Account more is refused", async () => {
    const people = () =>
      api.server.inject({
        method: "GET",
        url: "/authoring/people?telegram=community_failed",
        headers: owner,
      });
    const overview = async () =>
      (
        await api.server.inject({
          method: "GET",
          url: "/admin/overview",
          headers: owner,
        })
      ).json<{ attention: { communityFailures: Json } }>().attention
        .communityFailures;
    // At the bound the complete set answers; none of these Accounts is a person.
    const answered = await people();
    expect(answered.statusCode).toBe(200);
    expect(answered.json<{ total: number }>().total).toBe(0);
    expect(await overview()).toEqual({ state: "ready", count: 0 });

    await rejected(1);
    const refused = await people();
    expect(refused.statusCode).toBe(503);
    expect(refused.json<Json>()["code"]).toBe("dependency_unavailable");
    expect(await overview()).toEqual({ state: "unavailable" });
  });
});
