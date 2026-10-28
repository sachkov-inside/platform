import { describe, expect, it } from "vitest";

import {
  contactCaption,
  contactLabel,
  personName,
  selectionForProduct,
  selectionForTask,
  selectionLabels,
  selfCheckLine,
  taskOptions,
  taskValue,
  versionLines,
} from "@/_pages/task-submissions/model/submissions-list";
import {
  backendFeedback,
  isDefaultView,
  parseSubmissionsAddress,
  submissionsListHref,
} from "@/_pages/task-submissions/model/task-submissions";
import { presentTaskSubmissions } from "@/_pages/task-submissions/model/task-submissions-presentation";
import {
  reviewedSubmissions,
  submissionsProductId,
  submissionsSecondChapter,
} from "@/storybook/task-submissions.fixtures";

const firstChapter = "00000000-0000-4000-8000-000000000949";

describe("submissions list address (#1717)", () => {
  it("reads a missing, repeated or unknown feedback choice as the default «без комментария»", () => {
    for (const feedback of [undefined, "", "unknown", ["all", "given"]])
      expect(parseSubmissionsAddress({ feedback }).feedback).toBe("awaiting");
    expect(parseSubmissionsAddress({ feedback: "all" }).feedback).toBe("all");
    expect(parseSubmissionsAddress({ feedback: "given" }).feedback).toBe(
      "given",
    );
  });

  it("parses every list parameter and writes the default feedback as no parameter", () => {
    const address = parseSubmissionsAddress({
      productId: submissionsProductId,
      chapterId: firstChapter,
      task: "aie-ch1-onboarding",
      feedback: "given",
      cursor: "page-2",
      submission: "30000000-0000-4000-8000-000000000003",
      productCursor: "products-2",
    });
    expect(address).toEqual({
      selection: {
        productId: submissionsProductId,
        chapterId: firstChapter,
        taskCode: "aie-ch1-onboarding",
      },
      feedback: "given",
      cursor: "page-2",
      submissionId: "30000000-0000-4000-8000-000000000003",
      productCursor: "products-2",
    });
    expect(submissionsListHref(address)).toBe(
      `/authoring/submissions?productId=${submissionsProductId}&chapterId=${firstChapter}&task=aie-ch1-onboarding&feedback=given&cursor=page-2&submission=30000000-0000-4000-8000-000000000003&productCursor=products-2`,
    );
    expect(submissionsListHref({ selection: {}, feedback: "awaiting" })).toBe(
      "/authoring/submissions",
    );
    expect(submissionsListHref({ selection: {}, feedback: "all" })).toBe(
      "/authoring/submissions?feedback=all",
    );
  });

  it("sends the backend no filter for «все сдачи»", () => {
    expect(backendFeedback("awaiting")).toBe("awaiting");
    expect(backendFeedback("given")).toBe("given");
    expect(backendFeedback("all")).toBeUndefined();
  });

  it("treats only new submissions of every Product as the default view", () => {
    expect(isDefaultView({ selection: {}, feedback: "awaiting" })).toBe(true);
    expect(isDefaultView({ selection: {}, feedback: "all" })).toBe(false);
    expect(
      isDefaultView({
        selection: { productId: submissionsProductId },
        feedback: "awaiting",
      }),
    ).toBe(false);
  });
});

describe("submissions presentation (#1717)", () => {
  it("keeps the feedback choice in row, page, cursor and return addresses", () => {
    const presentation = presentTaskSubmissions({
      continued: true,
      cursor: "page-2",
      feedback: "all",
      selection: { productId: submissionsProductId },
      submissions: { ...reviewedSubmissions, nextCursor: "page-3" },
    });
    const base = `/authoring/submissions?productId=${submissionsProductId}&feedback=all`;
    expect(presentation.pageHref).toBe(`${base}&cursor=page-2`);
    expect(presentation.rows[0]?.href).toBe(
      `${base}&cursor=page-2&submission=30000000-0000-4000-8000-000000000003`,
    );
    expect(presentation.nextHref).toBe(`${base}&cursor=page-3`);
    expect(presentation.newestHref).toBe(base);
  });

  it("the default view leaves feedback out of every address", () => {
    const presentation = presentTaskSubmissions({
      continued: false,
      selection: {},
      submissions: { ...reviewedSubmissions, nextCursor: "page-2" },
    });
    expect(presentation.feedback).toBe("awaiting");
    expect(presentation.nextHref).toBe("/authoring/submissions?cursor=page-2");
    expect(presentation.rows[0]?.href).toBe(
      "/authoring/submissions?submission=30000000-0000-4000-8000-000000000003",
    );
  });

  it("calls a submission «новая» until Author Feedback exists, a comment or the legacy mark", () => {
    const markOnly = {
      comment: null,
      reviewedAt: "2026-10-04T12:00:00.000Z",
      updatedAt: "2026-10-04T12:00:00.000Z",
    };
    const presentation = presentTaskSubmissions({
      continued: false,
      selection: {},
      feedback: "all",
      submissions: {
        ...reviewedSubmissions,
        submissions: reviewedSubmissions.submissions.map((row, index) =>
          index === 2 ? { ...row, authorFeedback: markOnly } : row,
        ),
      },
    });
    expect(presentation.rows.map((row) => row.state)).toEqual([
      "submission.awaiting",
      "submission.commented",
      "submission.commented",
    ]);
  });

  it("names the person, the requirement version and the self-check without technical identifiers", () => {
    const [first, form, oldest] = reviewedSubmissions.submissions;
    if (first === undefined || form === undefined || oldest === undefined)
      throw new Error("fixture incomplete");
    expect(personName(first)).toBe("Анна Смирнова");
    expect(contactLabel(first)).toBe("@anna_example");
    expect(contactLabel(form)).toBe("Telegram не привязан");
    const usernameOnly = {
      ...first,
      person: { ...first.person, displayName: null },
    };
    expect(personName(usernameOnly)).toBe("@anna_example");
    expect(contactCaption(usernameOnly)).toBe("Имя в профиле не указано");
    expect(contactCaption(first)).toBe("@anna_example");
    expect(
      personName({
        ...form,
        person: { ...form.person, displayName: null },
      }),
    ).toBe("Имя не указано");
    expect(versionLines(first)).toEqual({ version: "Версия 2", current: null });
    expect(versionLines(oldest)).toEqual({
      version: "Версия 1",
      current: "Сейчас 2",
    });
    expect(selfCheckLine(first)).toBe("Нужны исправления, попытка 2");
    expect(selfCheckLine(form)).toBe("Без самопроверки");
  });
});

describe("submissions filter bar mapping (#1717)", () => {
  const { products } = reviewedSubmissions;

  it("offers chapters only inside a chosen Product", () => {
    expect(taskOptions(products, {}).map((option) => option.label)).toEqual([
      "Все задания",
      "Онбординг команды",
      "Заявки клиентов",
    ]);
    expect(
      taskOptions(products, { productId: submissionsProductId }).map(
        (option) => option.label,
      ),
    ).toEqual([
      "Все задания",
      "Глава 1. Онбординг: все задания",
      "Онбординг команды",
      "Глава 2. Заявки: все задания",
      "Заявки клиентов",
    ]);
  });

  it("maps a chapter or task choice to the server selection and back", () => {
    const chosen = { productId: submissionsProductId };
    const chapter = selectionForTask(
      chosen,
      `chapter:${submissionsSecondChapter}`,
    );
    expect(chapter).toEqual({
      productId: submissionsProductId,
      chapterId: submissionsSecondChapter,
    });
    expect(taskValue(chapter)).toBe(`chapter:${submissionsSecondChapter}`);
    const task = selectionForTask(chapter, "task:aie-ch2-requests");
    expect(task).toEqual({
      productId: submissionsProductId,
      taskCode: "aie-ch2-requests",
    });
    expect(taskValue(task)).toBe("task:aie-ch2-requests");
    expect(selectionForTask(task, "all")).toEqual(chosen);
    expect(selectionForProduct("all")).toEqual({});
    expect(selectionForProduct(submissionsProductId)).toEqual(chosen);
  });

  it("labels applied filters by name and gives an unknown value no chip", () => {
    expect(
      selectionLabels(
        {
          productId: submissionsProductId,
          chapterId: submissionsSecondChapter,
        },
        products,
      ),
    ).toEqual({ product: "AI Engineering", task: "Глава 2. Заявки" });
    expect(selectionLabels({ taskCode: "aie-ch2-requests" }, products)).toEqual(
      { task: "Заявки клиентов" },
    );
    expect(selectionLabels({ productId: "missing" }, products)).toEqual({});
  });
});
