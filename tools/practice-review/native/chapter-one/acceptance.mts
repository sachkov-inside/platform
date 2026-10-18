import assert from "node:assert/strict";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { accountId } from "../../../../apps/backend/src/modules/accounts/index.js";
import { taskDefinitionSchema } from "../../../../apps/backend/src/modules/product-tasks/domain/task-definition.js";
import { callTool, contextPartSchema } from "./mcp.mjs";
import type { startChapterStand } from "./stand.mjs";
import type { ChapterSnapshot } from "./contracts.mjs";

/** Real HTTP/MCP + PostgreSQL contracts; never a model-quality verdict. */
export async function checkPersistence(
  stand: Awaited<ReturnType<typeof startChapterStand>>,
  snapshot: ChapterSnapshot,
) {
  const results: string[] = [];
  const token = await stand.learnerToken();
  const call = (name: string, args: Record<string, unknown>) =>
    callTool(stand.serverUrl, token, name, args);
  const [firstTask] = snapshot.tasks;
  assert.ok(firstTask);
  const unauthorized = await fetch(stand.serverUrl, {
    method: "POST",
    headers: { authorization: "Bearer invalid" },
  });
  assert.equal(unauthorized.status, 401);
  results.push("invalid-token-refused");
  for (const task of snapshot.tasks) {
    const first = contextPartSchema.parse(
      await call("learning_task_read", { code: task.code, part: 0 }),
    );
    const parts = [first.value];
    let nextPart = first.value.nextPart;
    while (nextPart !== null) {
      parts.push(
        contextPartSchema.parse(
          await call("learning_task_read", {
            code: task.code,
            part: nextPart,
            expectedContextVersion: first.value.contextVersion,
            expectedContentSha256: first.value.contentSha256,
          }),
        ).value,
      );
      assert.ok(parts.length <= first.value.partCount);
      nextPart = parts.at(-1)?.nextPart ?? null;
    }
    for (const part of parts) {
      assert.equal(part.contextVersion, first.value.contextVersion);
      assert.equal(part.contentSha256, first.value.contentSha256);
      assert.equal(
        createHash("sha256").update(part.data).digest("hex"),
        part.partSha256,
      );
    }
    const serialized = parts.map((part) => part.data).join("");
    assert.equal(Buffer.byteLength(serialized), first.value.contentBytes);
    assert.equal(
      createHash("sha256").update(serialized).digest("hex"),
      first.value.contentSha256,
    );
    assert.ok(serialized.includes(`END_CONTEXT:${first.value.contextVersion}`));
    assert.equal(parts.at(-1)?.endOfContext, true);
    results.push(`complete-pinned-context:${task.code}`);
  }
  const report = {
    summary: "Проверка сохранения, а не оценка учебного решения.",
    criteria: firstTask.definition.criteria.map((criterion) => ({
      criterionId: criterion.id,
      status: "not_verified",
      evidence: "",
      gap: "Это контрактный запрос без проверки проекта.",
      obtainedByRun: false,
    })),
  };
  const submission = {
    code: firstTask.code,
    taskVersion: 1,
    submissionKey: randomUUID(),
    reviewReport: report,
    note: "Synthetic persistence acceptance",
  };
  const receipt = await call("learning_task_submit", submission);
  assert.deepEqual(await call("learning_task_submit", submission), receipt);
  results.push("same-key-same-receipt");
  assert.deepEqual(
    await call("learning_task_submit", { ...submission, note: "Changed" }),
    { ok: false, error: { code: "idempotency_conflict" } },
  );
  results.push("same-key-changed-content-refused");
  const saved = await stand.tasks.submissions({
    subject: stand.subject,
    code: firstTask.code,
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.value.submissions.length, 1);
  const [savedSubmission] = saved.value.submissions;
  assert.ok(savedSubmission);
  assert.deepEqual(savedSubmission.reviewReport, report);
  results.push("exact-report-persisted-and-reloaded");
  const outsider = await stand.tasks.submissions({
    subject: {
      kind: "account",
      accountId: accountId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    },
    code: firstTask.code,
  });
  assert.ok(outsider.ok && outsider.value.submissions.length === 0);
  results.push("other-account-cannot-read-submission");
  const feedback = await stand.review.saveFeedback(stand.owner, {
    submissionId: savedSubmission.submissionId,
    comment: "Тестовый отзыв автора",
    reviewed: true,
  });
  assert.equal(feedback.ok, true);
  const reloaded = await stand.tasks.submissions({
    subject: stand.subject,
    code: firstTask.code,
  });
  assert.ok(
    reloaded.ok &&
      reloaded.value.submissions[0]?.authorFeedback?.comment ===
        "Тестовый отзыв автора",
  );
  results.push("author-feedback-reloaded");
  const oldContext = contextPartSchema.parse(
    await call("learning_task_read", { code: firstTask.code, part: 0 }),
  );
  const taskRow = await stand.prisma.productTask.findUniqueOrThrow({
    where: { code: firstTask.code },
  });
  const oldVersion = await stand.prisma.productTaskVersion.findUniqueOrThrow({
    where: { taskId_version: { taskId: taskRow.id, version: 1 } },
  });
  await stand.prisma.productTaskVersion.create({
    data: {
      ...oldVersion,
      definition: taskDefinitionSchema.parse(oldVersion.definition),
      version: 2,
    },
  });
  await stand.prisma.productTask.update({
    where: { id: taskRow.id },
    data: { currentVersion: 2, revision: 2 },
  });
  const changed = await call("learning_task_read", {
    code: firstTask.code,
    part: 0,
    expectedContextVersion: oldContext.value.contextVersion,
  });
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.literal("task_context_version_mismatch") }),
  }).parse(changed);
  assert.deepEqual(
    await call("learning_task_submit", {
      ...submission,
      submissionKey: randomUUID(),
    }),
    {
      ok: false,
      error: {
        code: "task_version_changed",
        submittedVersion: 1,
        currentVersion: 2,
      },
    },
  );
  results.push("changed-context-and-stale-submission-refused");
  const history = await stand.tasks.submissions({
    subject: stand.subject,
    code: firstTask.code,
  });
  assert.ok(history.ok && history.value.submissions[0]?.taskVersion === 1);
  results.push("historical-submission-version-preserved");
  // Trials read v2 of the first task; tests never rewrite immutable versions.
  return results;
}
