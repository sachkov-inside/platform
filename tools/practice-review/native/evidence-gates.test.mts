import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  validateReviewEvidence,
  runtimeFailures,
  classifyWriteProbe,
} from "./evidence-gates.mjs";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function proof() {
  const version = "a".repeat(64);
  const body = JSON.stringify({
    contextVersion: version,
    terminalMarker: `END_CONTEXT:${version}`,
    payload: {
      practice: { definition: { criteria: [{ id: "one" }] } },
      reviewProtocol: { version: "2" },
    },
  });
  const halves = [body.slice(0, 80), body.slice(80)];
  const digest = sha(body);
  const pages = halves.map((data, part) => ({
    type: "item.completed",
    item: {
      type: "mcp_tool_call",
      tool: "learning_practice_read",
      status: "completed",
      arguments: {
        practiceId: "synthetic:test",
        part,
        expectedContextVersion: version,
        expectedContentSha256: digest,
      },
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              value: {
                practiceId: "synthetic:test",
                contextVersion: version,
                contentSha256: digest,
                contentBytes: Buffer.byteLength(body),
                part,
                partCount: 2,
                partSha256: sha(data),
                data,
                endOfContext: part === 1,
                nextPart: part === 1 ? null : 1,
              },
            }),
          },
        ],
      },
    },
  }));
  const read = {
    type: "item.completed",
    item: {
      type: "command_execution",
      command: "/bin/zsh -c 'cat app.mjs'",
      aggregated_output: "CURRENT SOURCE",
      exit_code: 0,
    },
  };
  const process = {
    code: 0,
    signal: null,
    timedOut: false,
    stderr: "",
    stdout: [...pages, read].map((row) => JSON.stringify(row)).join("\n"),
  };
  const report = {
    action: "report",
    contextVersion: version,
    terminalMarker: `END_CONTEXT:${version}`,
    partsRead: [0, 1],
    criteria: [{ id: "one", status: "confirmed" }],
  };
  return {
    client: "codex" as const,
    process,
    report,
    practiceId: "synthetic:test",
    files: [
      {
        path: "app.mjs",
        absolutePath: "/fixture/app.mjs",
        content: "CURRENT SOURCE",
      },
    ],
    expectedContextVersion: version,
  };
}
await test("complete native pages, pins, end marker and observed current read are required", () => {
  const input = proof();
  assert.equal(validateReviewEvidence(input).passed, true);
  const guessed = { ...input, process: { ...input.process, stdout: "" } };
  assert.equal(validateReviewEvidence(guessed).passed, false);
  assert.ok(
    validateReviewEvidence({
      ...input,
      report: {
        ...input.report,
        criteria: [...input.report.criteria, ...input.report.criteria],
      },
    }).failures.includes("incomplete_criterion_report"),
  );
  assert.ok(
    validateReviewEvidence({
      ...input,
      report: {
        ...input.report,
        criteria: [
          ...input.report.criteria,
          { id: "invented", status: "confirmed" },
        ],
      },
    }).failures.includes("incomplete_criterion_report"),
  );
  const recovered = {
    ...input,
    process: {
      ...input.process,
      stdout:
        JSON.stringify({ type: "error", message: "Reconnecting..." }) +
        "\n" +
        input.process.stdout,
    },
  };
  assert.equal(validateReviewEvidence(recovered).passed, true);
  const lines = input.process.stdout.split("\n");
  const missing = {
    ...input,
    process: { ...input.process, stdout: [lines[0], lines[2]].join("\n") },
  };
  assert.ok(
    validateReviewEvidence(missing).failures.includes("missing_context_parts"),
  );
  const noRead = {
    ...input,
    process: { ...input.process, stdout: lines.slice(0, 2).join("\n") },
  };
  assert.ok(
    validateReviewEvidence(noRead).failures.includes(
      "current_file_not_read:app.mjs",
    ),
  );
  const oldRead = {
    ...input,
    files: [
      {
        path: "app.mjs",
        absolutePath: "/fixture/app.mjs",
        content: "NEW SOURCE",
      },
    ],
  };
  assert.ok(
    validateReviewEvidence(oldRead).failures.includes(
      "current_file_not_read:app.mjs",
    ),
  );
  const malformed = {
    ...input,
    process: { ...input.process, stdout: input.process.stdout + "\n{broken" },
  };
  assert.ok(
    validateReviewEvidence(malformed).failures.includes(
      "malformed_native_event",
    ),
  );
  const changedPin = { ...input, expectedContextVersion: "b".repeat(64) };
  assert.ok(
    validateReviewEvidence(changedPin).failures.includes(
      "unpinned_recheck_context",
    ),
  );
});
await test("timeout, unsuccessful exit and failed cleanup cannot become acceptance", () => {
  const baseline = {
    auth: { code: 0, authorizationObserved: true, callbackSent: true },
    events: [{ kind: "token_exchange", pkce: true }],
    logout: { code: 0 },
    process: { code: 0, timedOut: false },
    projectUnchanged: true,
  };
  assert.deepEqual(runtimeFailures(baseline), []);
  assert.ok(
    runtimeFailures({
      ...baseline,
      process: { code: null, timedOut: true },
    }).includes("native_process_incomplete"),
  );
  assert.ok(
    runtimeFailures({
      ...baseline,
      process: { code: 1, timedOut: false },
    }).includes("native_process_incomplete"),
  );
  assert.ok(
    runtimeFailures({ ...baseline, logout: { code: 1 } }).includes(
      "native_logout_failed",
    ),
  );
  assert.ok(
    runtimeFailures({ ...baseline, projectUnchanged: false }).includes(
      "project_mutated_or_unobserved",
    ),
  );
});
await test("write probe classifies observed denial, unavailable tools and inconclusive separately", () => {
  const process = {
    code: 0,
    signal: null,
    timedOut: false,
    stderr: "",
    stdout: JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Write was denied." },
    }),
  };
  assert.equal(classifyWriteProbe("codex", process), "inconclusive");
  const denied = {
    ...process,
    stdout: JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "printf CHANGED > sentinel.txt",
        aggregated_output: "Operation not permitted",
        exit_code: 1,
      },
    }),
  };
  assert.equal(classifyWriteProbe("codex", denied), "tool-denied");
  const absent = {
    ...process,
    stdout: JSON.stringify({
      type: "system",
      subtype: "init",
      tools: ["Read", "Glob", "Grep"],
    }),
  };
  assert.equal(classifyWriteProbe("claude", absent), "tools-unavailable");
  assert.equal(
    classifyWriteProbe("claude", { ...absent, timedOut: true }),
    "inconclusive",
  );
});
