import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { PendingLinkConfirmationPump } from "../../src/modules/telegram-membership/adapters/nest/pending-link-confirmation.pump.js";

const communityEnvironment = {
  TELEGRAM_COMMUNITY_DISPATCH_SECRET: "pump-test-community-dispatch-secret",
  TELEGRAM_COMMUNITY_ENTITLEMENT_ENDPOINT:
    "http://127.0.0.1:9/integrations/platform/v1/community-entitlements",
  TELEGRAM_COMMUNITY_ENTITLEMENT_SECRET: "pump-test-community-provider-secret",
};

describe("PendingLinkConfirmationPump", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function pump(communityConfigured: boolean) {
    const confirmPendingLinks = vi.fn(() =>
      Promise.resolve({ linked: 0, pending: 0 }),
    );
    const { communityEntitlements } = parsePlatformConfig(
      communityConfigured
        ? { NODE_ENV: "test", ...communityEnvironment }
        : { NODE_ENV: "test" },
    );
    return {
      confirmPendingLinks,
      pump: new PendingLinkConfirmationPump(
        { confirmPendingLinks },
        { communityEntitlements },
      ),
    };
  }

  test("finishes waiting links every few seconds where the community is configured", async () => {
    const { confirmPendingLinks, pump: running } = pump(true);
    running.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(confirmPendingLinks).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(confirmPendingLinks).toHaveBeenCalledTimes(2);

    await running.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(confirmPendingLinks).toHaveBeenCalledTimes(2);
  });

  test("stays idle without the community direction", async () => {
    const { confirmPendingLinks, pump: idle } = pump(false);
    idle.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(confirmPendingLinks).not.toHaveBeenCalled();
  });
});
