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
