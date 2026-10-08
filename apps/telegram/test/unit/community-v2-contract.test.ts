import { describe, expect, it } from "vitest";
import {
  COMMUNITY_V2,
  assertCommunityResult,
  parseCommunityRequest,
  validDispatchResponse,
  type CommunityResult,
} from "../../src/modules/community/community-contract.js";
import fixtures from "@inside/contracts/community-v2/fixtures.json" with { type: "json" };

describe("portable v2 runtime corpus", () => {
  for (const fixture of fixtures) {
    if (fixture.definition === "communityRequest")
      it(fixture.name, () => {
        expect(
          parseCommunityRequest(fixture.value, COMMUNITY_V2).kind !==
            "rejected",
        ).toBe(fixture.valid);
      });
    if (
      fixture.definition === "communityResponse" &&
      fixture.value.operation === "entitlement.result"
    )
      it(fixture.name, () => {
        const run = () =>
          assertCommunityResult(
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- invalid fixtures must reach the runtime contract check.
            fixture.value as unknown as CommunityResult,
          );
        if (fixture.valid) expect(run).not.toThrow();
        else expect(run).toThrow();
      });
    if (fixture.definition === "authorizationResponse")
      it(fixture.name, () => {
        expect(validDispatchResponse(fixture.value)).toBe(fixture.valid);
      });
  }
});
