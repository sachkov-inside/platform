import { describe, expect, it } from "vitest";
import { costNanoUsd } from "../../src/modules/course-assistant/domain/assistant-usage.js";
import {
  compareWithPreviousReview,
  practiceReviewReportSchema,
  practiceStatusOf,
  practiceStatusOfReviews,
  reviewKindOf,
  type PracticeReviewReport,
} from "../../src/modules/course-assistant/domain/practice-review.js";
import { candidatesOf } from "../../src/modules/course-assistant/domain/review-candidate.js";

const criteria = ["request", "status", "ownership"] as const;

function report(
  statuses: Readonly<
    Record<
      (typeof criteria)[number],
      "confirmed" | "violation" | "not_verified"
    >
  >,
): PracticeReviewReport {
  return {
    summary: "Итог проверки",
    criteria: criteria.map((criterionId) => ({
      criterionId,
      status: statuses[criterionId],
      evidence: [{ path: "docs/brief.md", startLine: 1, endLine: 4 }],
      explanation: "Связь свидетельства с требованием.",
      nextStep:
        statuses[criterionId] === "confirmed" ? null : "Что сделать дальше.",
    })),
  };
}

describe("Practice Review report", () => {
  const schema = practiceReviewReportSchema(criteria, {
    hasFile: (path) => path === "docs/brief.md",
  });

  it("accepts exactly one verdict for every criterion of the assignment", () => {
    const value = report({
      request: "confirmed",
      status: "violation",
      ownership: "not_verified",
    });
    expect(schema.safeParse(value).success).toBe(true);
  });

  it("rejects a missing, repeated or unknown criterion", () => {
    const value = report({
      request: "confirmed",
      status: "confirmed",
      ownership: "confirmed",
    });
    expect(
      schema.safeParse({ ...value, criteria: value.criteria.slice(1) }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...value,
        criteria: [...value.criteria, value.criteria[0]],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...value,
        criteria: value.criteria.map((item, index) =>
          index === 0 ? { ...item, criterionId: "invented" } : item,
        ),
      }).success,
    ).toBe(false);
  });

  it("requires a next step for violation and not_verified", () => {
    const value = report({
      request: "violation",
      status: "confirmed",
      ownership: "confirmed",
    });
    expect(
      schema.safeParse({
        ...value,
        criteria: value.criteria.map((item) => ({ ...item, nextStep: null })),
      }).success,
    ).toBe(false);
  });

  it("rejects evidence paths outside the repository and inverted line ranges", () => {
    const value = report({
      request: "confirmed",
      status: "confirmed",
      ownership: "confirmed",
    });
    for (const evidence of [
      { path: "../secrets.txt", startLine: 1, endLine: 1 },
      { path: "/etc/passwd", startLine: 1, endLine: 1 },
      { path: "docs/brief.md", startLine: 5, endLine: 2 },
    ])
      expect(
        schema.safeParse({
          ...value,
          criteria: value.criteria.map((item) => ({
            ...item,
            evidence: [evidence],
          })),
        }).success,
      ).toBe(false);
  });
});

describe("Practice Status", () => {
  it("is accepted only when every criterion is confirmed", () => {
    expect(
      practiceStatusOf(
        report({
          request: "confirmed",
          status: "confirmed",
          ownership: "confirmed",
        }),
      ),
    ).toBe("accepted");
    expect(
      practiceStatusOf(
        report({
          request: "confirmed",
          status: "not_verified",
          ownership: "confirmed",
        }),
      ),
    ).toBe("needs_work");
    expect(
      practiceStatusOf(
        report({
          request: "violation",
          status: "confirmed",
          ownership: "confirmed",
        }),
      ),
    ).toBe("needs_work");
  });
});

describe("recheck changes", () => {
  it("names the earlier status of every criterion and whether it changed", () => {
    const previous = report({
      request: "confirmed",
      status: "violation",
      ownership: "not_verified",
    });
    const current = report({
      request: "confirmed",
      status: "confirmed",
      ownership: "not_verified",
    });
    expect(compareWithPreviousReview(previous, current)).toEqual([
      { criterionId: "request", previousStatus: "confirmed", changed: false },
      { criterionId: "status", previousStatus: "violation", changed: true },
      {
        criterionId: "ownership",
        previousStatus: "not_verified",
        changed: false,
      },
    ]);
  });

  it("marks a criterion that did not exist in the earlier review as new", () => {
    const previous: PracticeReviewReport = {
      summary: "Прошлый итог",
      criteria: [],
    };
    const current = report({
      request: "confirmed",
      status: "confirmed",
      ownership: "confirmed",
    });
    expect(compareWithPreviousReview(previous, current)[0]).toEqual({
      criterionId: "request",
      previousStatus: null,
      changed: true,
    });
  });
});

describe("Practice Status from reviews", () => {
  it("follows the running review, then the latest completed one; a failure changes nothing", () => {
    expect(practiceStatusOfReviews([])).toBe("not_started");
    expect(
      practiceStatusOfReviews([
        { state: "running", practiceStatus: null },
        { state: "completed", practiceStatus: "accepted" },
      ]),
    ).toBe("in_review");
    expect(
      practiceStatusOfReviews([
        { state: "awaiting_choice", practiceStatus: null },
      ]),
    ).toBe("in_review");
    expect(
      practiceStatusOfReviews([
        { state: "failed", practiceStatus: null },
        { state: "completed", practiceStatus: "needs_work" },
        { state: "completed", practiceStatus: "accepted" },
      ]),
    ).toBe("needs_work");
    expect(
      practiceStatusOfReviews([{ state: "failed", practiceStatus: null }]),
    ).toBe("not_started");
  });
});

describe("Assistant Usage cost", () => {
  it("prices uncached input, cached input and output separately", () => {
    expect(
      costNanoUsd(
        {
          inputTokens: 1_000_000,
          cachedInputTokens: 400_000,
          outputTokens: 10_000,
        },
        {
          version: "2026-09-29",
          inputPerMillion: 1.25,
          cachedInputPerMillion: 0.125,
          outputPerMillion: 10,
        },
      ),
    ).toBe(900_000_000n);
  });
});

describe("review kind", () => {
  it("reads a stored kind strictly", () => {
    expect(reviewKindOf("initial")).toBe("initial");
    expect(reviewKindOf("recheck")).toBe("recheck");
    expect(() => reviewKindOf("retry")).toThrow();
  });
});

describe("review candidates", () => {
  const pull = (
    number: number,
    extra: { readonly draft?: boolean; readonly authorIsBot?: boolean } = {},
  ) => ({
    number,
    title: `PR ${String(number)}`,
    headRef: `feature-${String(number)}`,
    headSha: String(number).repeat(40),
    baseRef: "main",
    baseSha: "a".repeat(40),
    draft: extra.draft ?? false,
    authorIsBot: extra.authorIsBot ?? false,
  });

  it("offers the default branch and every open pull request except drafts and bot pull requests", () => {
    const candidates = candidatesOf({
      defaultBranch: { name: "main", sha: "a".repeat(40) },
      pullRequests: [
        pull(3),
        pull(4, { draft: true }),
        pull(5, { authorIsBot: true }),
        pull(6),
      ],
      recentCommits: [],
    });
    expect(
      candidates.map((candidate) =>
        candidate.kind === "default_branch" ? candidate.ref : candidate.number,
      ),
    ).toEqual(["main", 3, 6]);
  });
});
