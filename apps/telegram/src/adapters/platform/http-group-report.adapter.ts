import { communityMembersWithoutRightSchema } from "@inside/contracts/community-members-without-right";
import type { WithoutRightSnapshot } from "../../modules/community/group-members-report.js";

/** Uses the existing operator endpoint, not the bot's integration bearer. */
export async function readGroupReportRights(
  endpoint: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<WithoutRightSnapshot> {
  const url = new URL(endpoint);
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ))
  ) {
    throw new Error("Unsafe operator endpoint");
  }
  const response = await fetcher(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error("Operator report unavailable");
  const value: unknown = await response.json();
  const parsed = communityMembersWithoutRightSchema.parse(value);
  return {
    checkedAt: parsed.checkedAt,
    truncated: parsed.truncated,
    identities: new Map(
      parsed.items.map((item) => [item.telegramIdentityRef, item.accountId]),
    ),
  };
}
