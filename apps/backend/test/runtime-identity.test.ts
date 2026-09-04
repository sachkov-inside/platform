import { describe, expect, it } from "vitest";

import { parseRuntimeIdentity } from "../src/infrastructure/runtime-identity.js";

describe("runtime release identity", () => {
  it("accepts an exact production release and image identity", () => {
    expect(
      parseRuntimeIdentity(
        {
          PLATFORM_RELEASE_VERSION: "v12",
          PLATFORM_SOURCE_SHA: "a".repeat(40),
        },
        "production",
        { release: "v12", sourceSha: "a".repeat(40) },
      ),
    ).toEqual({ release: "v12", sourceSha: "a".repeat(40) });
  });

  it("fails closed when the selected release does not match the image", () => {
    expect(() =>
      parseRuntimeIdentity(
        {
          PLATFORM_RELEASE_VERSION: "v13",
          PLATFORM_SOURCE_SHA: "a".repeat(40),
        },
        "production",
        { release: "v12", sourceSha: "a".repeat(40) },
      ),
    ).toThrow(
      "Runtime release identity does not match the immutable image identity",
    );
  });

  it("requires a complete immutable identity in production", () => {
    expect(() => parseRuntimeIdentity({}, "production")).toThrow(
      "PLATFORM_RELEASE_VERSION is required in production mode",
    );
  });

  it("rejects a release ordinal outside the safe integer range", () => {
    const release = "v9007199254740992";
    expect(() =>
      parseRuntimeIdentity(
        {
          PLATFORM_RELEASE_VERSION: release,
          PLATFORM_SOURCE_SHA: "a".repeat(40),
        },
        "production",
        { release, sourceSha: "a".repeat(40) },
      ),
    ).toThrow("Runtime release identity is invalid");
  });

  it("uses a deterministic identity for local process modes", () => {
    expect(parseRuntimeIdentity({}, "test")).toEqual({
      release: "test",
      sourceSha: "0".repeat(40),
    });
  });
});
