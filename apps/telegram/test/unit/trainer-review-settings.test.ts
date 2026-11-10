import { describe, expect, it } from "vitest";

import {
  reviewDatabaseUrl,
  permitsReviewPost,
} from "../../scripts/trainer-widget/review-settings.js";

describe("local Trainer review boundaries", () => {
  it("accepts only the loopback port reported by its own Compose project", () => {
    expect(
      reviewDatabaseUrl("127.0.0.1:25495\n", "trainer_review_abcdef12"),
    ).toBe(
      "postgresql://inside:inside@127.0.0.1:25495/trainer_review_abcdef12",
    );
    for (const address of [
      "0.0.0.0:5432",
      "production:5432",
      "127.0.0.1:0",
      "127.0.0.1:65536",
      "127.0.0.1:5432/path",
    ]) {
      expect(() =>
        reviewDatabaseUrl(address, "trainer_review_abcdef12"),
      ).toThrow();
    }
  });

  it("refuses an existing application database", () => {
    expect(() =>
      reviewDatabaseUrl("127.0.0.1:5432", "inside_telegram"),
    ).toThrow();
    expect(() => reviewDatabaseUrl("127.0.0.1:5432", "postgres")).toThrow();
  });

  it("accepts mutations only from its own browser origin with JSON", () => {
    expect(
      permitsReviewPost(
        "http://127.0.0.1:3409",
        "application/json",
        "http://127.0.0.1:3409",
      ),
    ).toBe(true);
    expect(
      permitsReviewPost(
        "https://other.example",
        "application/json",
        "http://127.0.0.1:3409",
      ),
    ).toBe(false);
    expect(
      permitsReviewPost(undefined, "application/json", "http://127.0.0.1:3409"),
    ).toBe(false);
    expect(
      permitsReviewPost(
        "http://127.0.0.1:3409",
        "text/plain",
        "http://127.0.0.1:3409",
      ),
    ).toBe(false);
  });
});
