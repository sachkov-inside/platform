import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import { z } from "zod";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";
import { signInFullStack } from "../support/full-stack-session";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`Missing ${name} for #948`);
  return value;
}

const grantSchema = z.object({ access_token: z.string() }).loose();
const rpcSchema = z
  .object({
    result: z
      .object({
        content: z.array(z.object({ type: z.string(), text: z.string() })),
      })
      .loose(),
  })
  .loose();
const initializeSchema = z
  .object({ result: z.object({ protocolVersion: z.string() }).loose() })
  .loose();

/**
 * The learner's agent on the learner MCP endpoint: it takes a fresh `learning:read` token with the
 * refresh token the launcher gave it, then speaks plain JSON-RPC like any MCP client.
 */
async function callLearningTool(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const endpoint = required("FULLSTACK_LEARNING_MCP_URL");
  const grant = await request.post(required("FULLSTACK_IDENTITY_TOKEN_URL"), {
    form: {
      grant_type: "refresh_token",
      refresh_token: required("FULLSTACK_NON_MEMBER_REFRESH_TOKEN"),
      resource: endpoint,
    },
  });
  expect(grant.status()).toBe(200);
  const token = grantSchema.parse(await grant.json()).access_token;
  const headers = {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const initialized = await request.post(endpoint, {
    headers,
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "inside-fullstack-learner", version: "1.0.0" },
      },
    },
  });
  expect(initialized.status()).toBe(200);
  const session = initialized.headers()["mcp-session-id"];
  const called = await request.post(endpoint, {
    headers: {
      ...headers,
      "mcp-protocol-version": initializeSchema.parse(await rpcBody(initialized))
        .result.protocolVersion,
      ...(session === undefined ? {} : { "mcp-session-id": session }),
    },
    data: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  expect(called.status()).toBe(200);
  const text = rpcSchema.parse(await rpcBody(called)).result.content[0]?.text;
  if (text === undefined) throw new Error(`${name} answered without text`);
  return JSON.parse(text) as unknown;
}

/**
 * One JSON-RPC answer: the endpoint may answer as JSON or as one server-sent event, and a client
 * accepts both.
 */
async function rpcBody(response: APIResponse): Promise<unknown> {
  const text = await response.text();
  if (!(response.headers()["content-type"] ?? "").includes("text/event-stream"))
    return JSON.parse(text) as unknown;
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .at(-1);
  if (data === undefined) throw new Error("The event stream carried no data");
  return JSON.parse(data) as unknown;
}

/** The member session greets with the Telegram and storage notices; they cover the page. */
async function dismissNotices(page: Page) {
  await page
    .getByRole("button", { name: "Закрыть подключение Telegram" })
    .click();
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
}

test("the author marks an agent's submission and comments it; the learner reads both through the learner MCP (#948)", async ({
  context,
  page,
  request,
}, testInfo) => {
  const code = required("FULLSTACK_TASK_CODE");
  const note = `Сдача агента ${testInfo.project.name} ${randomUUID().slice(0, 8)}.`;
  const comment = `Отзыв автора для ${testInfo.project.name}: повтор заявки проверен.`;

  const submitted = z
    .object({
      ok: z.literal(true),
      value: z.object({ submissionId: z.uuid() }).loose(),
    })
    .loose()
    .parse(
      await callLearningTool(request, "learning_task_submit", {
        code,
        taskVersion: 1,
        submissionKey: randomUUID(),
        reviewReport: {
          criteria: [
            {
              criterionId: "request",
              status: "confirmed",
              evidence: "<b>README.md</b> описывает создание заявки.",
              gap: "",
              obtainedByRun: false,
            },
            {
              criterionId: "deduplication",
              status: "not_verified",
              evidence: "",
              gap: "Повтор не проверен.",
              obtainedByRun: false,
            },
          ],
        },
        note,
        serviceMark: {
          repositoryUrl: "https://github.com/learner/requests",
          branch: "main",
          commit: "abcdef1",
        },
      }),
    );

  // Exactly `materials:manage`: the section needs no other permission.
  await signInFullStack(context, "MATERIALS_ONLY");
  await page.goto(`/authoring/submissions?task=${code}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Сдачи" }),
  ).toBeVisible();
  const card = page.locator(
    `[data-submission="${submitted.value.submissionId}"]`,
  );
  await expect(card.getByText(note)).toBeVisible();
  await expect(card.getByText("Через агента")).toBeVisible();
  await card.getByText("Отчёт агента ученика", { exact: true }).click();
  await expect(
    card.getByText("<b>README.md</b> описывает создание заявки.", {
      exact: false,
    }),
  ).toBeVisible();
  await card.getByRole("checkbox", { name: "Посмотрел автор" }).check();
  await card
    .getByRole("textbox", { name: /Комментарий для ученика/u })
    .fill(comment);
  await card.getByRole("button", { name: "Сохранить отзыв" }).click();
  await expect(
    card.getByText("Сохранено. Ученик увидит отзыв на странице задания."),
  ).toBeVisible();

  await page.reload();
  const reloaded = page.locator(
    `[data-submission="${submitted.value.submissionId}"]`,
  );
  await expect(
    reloaded.getByRole("textbox", { name: /Комментарий для ученика/u }),
  ).toHaveValue(comment);
  await expect(
    reloaded.getByRole("checkbox", { name: "Посмотрел автор" }),
  ).toBeChecked();
  const violations = (
    await new AxeBuilder({ page }).include("main").analyze()
  ).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(violations).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  const evidence = await prepareEvidenceDirectory("issue-948");
  await reloaded.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(evidence, `submissions-${testInfo.project.name}.png`),
    animations: "disabled",
    fullPage: false,
  });

  const own = z
    .object({
      ok: z.literal(true),
      value: z
        .object({
          submissions: z.array(
            z
              .object({
                submissionId: z.string(),
                authorFeedback: z
                  .object({
                    comment: z.string().nullable(),
                    reviewedAt: z.string().nullable(),
                  })
                  .loose()
                  .nullable(),
              })
              .loose(),
          ),
        })
        .loose(),
    })
    .loose()
    .parse(
      await callLearningTool(request, "learning_task_submissions", { code }),
    );
  const mine = own.value.submissions.find(
    (item) => item.submissionId === submitted.value.submissionId,
  );
  expect(mine?.authorFeedback?.comment).toBe(comment);
  expect(typeof mine?.authorFeedback?.reviewedAt).toBe("string");

  await signInFullStack(context, "NON_MEMBER");
  await page.goto(
    `/products/${required("FULLSTACK_TASK_GUIDE_SLUG")}/tasks/${code}`,
  );
  await dismissNotices(page);
  const learnerView = page.locator(
    `[data-submission="${submitted.value.submissionId}"]`,
  );
  await expect(learnerView.getByText(comment)).toBeVisible();
  await expect(learnerView.getByText(/Посмотрел автор/u)).toBeVisible();
});

test("an Account without materials:manage sees no submissions (#948)", async ({
  context,
  page,
}) => {
  await signInFullStack(context, "NON_MEMBER");
  await page.goto("/authoring/submissions");
  await expect(
    page.locator('[data-task-submissions-state="forbidden"]'),
  ).toBeVisible();
  await expect(page.locator("[data-submission]")).toHaveCount(0);
});
