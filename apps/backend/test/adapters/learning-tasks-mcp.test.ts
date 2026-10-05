import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, test } from "vitest";
import { z } from "zod";

import { assembleLearnerMcpServer } from "../../src/modules/content-library/index.js";
import { taskReviewProtocol } from "../../src/modules/guide-tasks/domain/review-protocol.js";
import { practiceReviewProtocol } from "../../src/modules/content-library/features/read-learning-practice/review-protocol.js";
import {
  committedLearnerToolSurfacePath,
  parseToolSurface,
} from "../../scripts/mcp-tool-surface-file.js";
import { refusingLearnerMcpDependencies } from "../fixtures/learner-mcp.js";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function connect() {
  const server = assembleLearnerMcpServer({
    ...refusingLearnerMcpDependencies(),
    accountId,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "task-protocol-test", version: "1" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe("Guide Task tools on the learner MCP", () => {
  test("the endpoint lists exactly the committed learner tool surface, including the four task tools", async () => {
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      const names = tools.map(({ name }) => name).sort();
      expect(names).toEqual(
        parseToolSurface(
          readFileSync(committedLearnerToolSurfacePath, "utf8"),
          committedLearnerToolSurfacePath,
        ),
      );
      expect(names).toEqual(
        expect.arrayContaining([
          "learning_tasks_list",
          "learning_task_read",
          "learning_task_submit",
          "learning_task_submissions",
        ]),
      );
    } finally {
      await client.close();
    }
  });

  test("submission writes without destroying and is idempotent; every other task tool only reads", async () => {
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      const annotations = new Map(
        tools.map((tool) => [tool.name, tool.annotations]),
      );
      expect(annotations.get("learning_task_submit")).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      for (const name of [
        "learning_tasks_list",
        "learning_task_read",
        "learning_task_submissions",
      ])
        expect(annotations.get(name)).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
        });
    } finally {
      await client.close();
    }
  });

  test("the review_task prompt carries procedure v3 word for word for the named task code", async () => {
    const client = await connect();
    try {
      const { prompts } = await client.listPrompts();
      expect(prompts.map(({ name }) => name)).toEqual(["review_task"]);
      expect(prompts[0]?.arguments).toEqual([
        expect.objectContaining({ name: "code", required: true }),
      ]);
      const prompt = await client.getPrompt({
        name: "review_task",
        arguments: { code: "aie-ch1-onboarding" },
      });
      const text = z
        .object({ type: z.literal("text"), text: z.string() })
        .parse(prompt.messages[0]?.content).text;
      expect(text).toContain("aie-ch1-onboarding");
      expect(text).toContain(`v${taskReviewProtocol.version}`);
      for (const instruction of taskReviewProtocol.instructions)
        expect(text).toContain(instruction);
      // Lesson practice keeps procedure v2; v3 is a different text, not its edit.
      expect(taskReviewProtocol.version).toBe("3");
      expect(practiceReviewProtocol.version).toBe("2");
    } finally {
      await client.close();
    }
  });

  test("server instructions say the endpoint reads and accepts submissions but never grades, changes projects or grants access", async () => {
    const client = await connect();
    try {
      const instructions = client.getInstructions() ?? "";
      expect(instructions).toContain("accepts submissions");
      expect(instructions).toContain(
        "It does not grade work, change projects or grant access.",
      );
      expect(instructions).not.toContain("This surface only reads");
    } finally {
      await client.close();
    }
  });
});
