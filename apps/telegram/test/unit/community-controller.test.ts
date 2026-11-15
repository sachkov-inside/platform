import { describe, expect, it } from "vitest";

import type { ApplicationConfig } from "../../src/config/application-config.js";
import { CommunityController } from "../../src/modules/community/community.controller.js";
import type { CommunityProvider } from "../../src/modules/community/community-provider.js";

describe("community entitlement HTTP surface", () => {
  it("answers Platform with the provider answer, which carries the join reminders (#2092)", async () => {
    const calls: string[] = [];
    const body = { operation: "entitlement.result" };
    const provider = {
      answer: (request: unknown) => {
        calls.push(`answer:${JSON.stringify(request)}`);
        return Promise.resolve({ status: 200, body });
      },
      handle: () => {
        calls.push("handle");
        return Promise.resolve({ status: 200 });
      },
    };
    const controller = new CommunityController(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the controller reads only this secret.
      { communityIntegrationSecret: "synthetic-secret" } as ApplicationConfig,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a double of the two inbound methods.
      provider as unknown as CommunityProvider,
    );

    expect(await controller.apply("Bearer synthetic-secret", { a: 1 })).toBe(
      body,
    );
    expect(calls).toEqual(['answer:{"a":1}']);
  });
});
