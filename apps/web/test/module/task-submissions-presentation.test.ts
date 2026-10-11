import { expect, it } from "vitest";

import { presentTaskSubmissions } from "@/_pages/task-submissions/model/task-submissions-presentation";
import { reviewedSubmissions } from "@/storybook/task-submissions.fixtures";

it("shows the complete submitted report against its historical requirements, not the current task version (#967)", () => {
  const presentation = presentTaskSubmissions({
    submissions: reviewedSubmissions,
    selection: { taskCode: "aie-ch1-onboarding" },
    continued: true,
  });
  const oldest = presentation.rows[2];
  expect(oldest?.criteria.map((item) => item.id)).toEqual(["access", "owner"]);
  expect(oldest?.submission.taskVersion).toBe(1);
  expect(
    presentation.rows[0]?.submission.reviewReport?.criteria[1]?.evidence,
  ).toBe('<img src=x onerror="alert(1)"> Роль читается из запроса.');
  expect(presentation.rows[1]?.submission.reportText).toBe(
    "Проверил сам: заявка создаётся, повтор не создаёт вторую.",
  );
  expect(presentation.newestHref).toBe(
    "/authoring/submissions?task=aie-ch1-onboarding",
  );
});

it("passes only the supported Telegram contact destination to the UI (#1351)", () => {
  const present = (telegramUrl: string | null) =>
    presentTaskSubmissions({
      submissions: {
        ...reviewedSubmissions,
        submissions: reviewedSubmissions.submissions.map((submission) => ({
          ...submission,
          person: { ...submission.person, telegramUrl },
        })),
      },
      selection: {},
      continued: false,
    });
  expect(present("https://t.me/anna_example").rows[0]?.telegramHref).toBe(
    "https://t.me/anna_example",
  );
  for (const url of [
    null,
    "javascript:alert(1)",
    "https://example.test/anna_example",
    "https://t.me/someone_else",
  ]) {
    expect(present(url).rows[0]?.telegramHref).toBeNull();
  }
});
