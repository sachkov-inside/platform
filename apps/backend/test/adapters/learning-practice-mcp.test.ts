import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, test } from "vitest";
import { assembleLearnerMcpServer } from "../../src/modules/content-library/index.js";
import { refusingLearnerMcpDependencies } from "../fixtures/learner-mcp.js";

test("current learner discovery and dispatch retire Practice reads while preserving Task operations", async () => {
  const server = assembleLearnerMcpServer({
    ...refusingLearnerMcpDependencies(),
    accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const client = new Client({
    name: "retired-practice-contract",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).not.toContain(
      "learning_practice_read",
    );
    expect(tools.tools.map((tool) => tool.name)).toContain(
      "learning_task_read",
    );
    await expect(
      client.callTool({
        name: "learning_practice_read",
        arguments: { practiceId: "historical:opaque", part: 0 },
      }),
    ).rejects.toThrow();
  } finally {
    await client.close();
    await server.close();
  }
});
