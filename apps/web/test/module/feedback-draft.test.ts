import { describe, expect, it } from "vitest";

import {
  initialFeedbackDraft,
  reconcileFeedbackDraft,
} from "@/_pages/task-submissions/model/feedback-draft";
import type { AuthorFeedback } from "@/_pages/task-submissions/model/task-submissions";

const first: AuthorFeedback = {
  comment: "Первый отзыв",
  reviewedAt: null,
  updatedAt: "2026-10-11T09:00:00.000Z",
};
const second: AuthorFeedback = {
  comment: "Исправленный отзыв",
  reviewedAt: "2026-10-11T09:01:00.000Z",
  updatedAt: "2026-10-11T09:01:00.000Z",
};

describe("feedback across server page snapshots", () => {
  it("keeps the second acknowledged save when an intermediate filtered page arrives", () => {
    const stored = {
      ...initialFeedbackDraft(null),
      comment: second.comment ?? "",
      reviewed: true,
      saved: second,
      result: { kind: "saved", authorFeedback: second } as const,
    };
    expect(reconcileFeedbackDraft(stored, first)).toEqual(stored);
  });

  it("does not resurrect a cleared feedback from an old page snapshot", () => {
    const stored = {
      ...initialFeedbackDraft(first),
      comment: "",
      reviewed: false,
      saved: null,
      clearedLocally: true,
      result: { kind: "saved", authorFeedback: null } as const,
    };
    expect(reconcileFeedbackDraft(stored, second)).toEqual(stored);
    const edited = {
      ...stored,
      comment: "Новый черновик после удаления",
      result: null,
    };
    expect(reconcileFeedbackDraft(edited, second)).toEqual(edited);
  });

  it("adopts a newer server answer without discarding the author's unsaved text", () => {
    const stored = {
      ...initialFeedbackDraft(first),
      comment: "Несохранённый черновик",
    };
    const reconciled = reconcileFeedbackDraft(stored, second);
    expect(reconciled.comment).toBe("Несохранённый черновик");
    expect(reconciled.saved).toEqual(second);
    expect(reconciled.reviewed).toBe(false);
  });

  it("keeps the in-flight input until its own mutation answers", () => {
    const stored = {
      ...initialFeedbackDraft(first),
      comment: "Отправляемый отзыв",
      pending: true,
    };
    expect(reconcileFeedbackDraft(stored, second)).toEqual(stored);
  });
});
