import { createHash } from "node:crypto";
import { z } from "zod";
import type { NativeClient, NativeProcessResult } from "./client-process.mjs";

const object = z.record(z.string(), z.unknown());
const textContent = z.object({ type: z.literal("text"), text: z.string() });
const block = z.object({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  tool_use_id: z.string().optional(),
  is_error: z.boolean().optional(),
  content: z.unknown().optional(),
});
const event = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  tools: z.array(z.string()).optional(),
  item: z
    .object({
      type: z.string(),
      status: z.string().optional(),
      tool: z.string().optional(),
      arguments: z.unknown().optional(),
      result: z.unknown().optional(),
      command: z.string().optional(),
      aggregated_output: z.string().optional(),
      exit_code: z.number().nullable().optional(),
    })
    .optional(),
  message: z
    .union([z.string(), z.object({ content: z.array(block) })])
    .optional(),
});
const page = z.object({
  ok: z.literal(true),
  value: z.object({
    practiceId: z.string(),
    contextVersion: z.hash("sha256"),
    contentSha256: z.hash("sha256"),
    contentBytes: z.number().int(),
    part: z.number().int().nonnegative(),
    partCount: z.number().int().positive(),
    partSha256: z.hash("sha256"),
    data: z.string(),
    endOfContext: z.boolean(),
    nextPart: z.number().int().nullable(),
  }),
});
const argsSchema = z.object({
  practiceId: z.string(),
  part: z.number().int().default(0),
  expectedContextVersion: z.string().optional(),
  expectedContentSha256: z.string().optional(),
});
const context = z.object({
  contextVersion: z.string(),
  terminalMarker: z.string(),
  payload: z.object({
    practice: z.object({
      definition: z.object({ criteria: z.array(z.object({ id: z.string() })) }),
    }),
    reviewProtocol: z.object({ version: z.string() }),
  }),
});
const report = z.object({
  action: z.enum(["report", "clarify_scope"]),
  contextVersion: z.string().optional(),
  partsRead: z.array(z.number()).optional(),
  terminalMarker: z.string().optional(),
  criteria: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(["confirmed", "violation", "not_verified"]),
      }),
    )
    .optional(),
  question: z.string().nullable().optional(),
});
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function texts(value: unknown): string {
  if (typeof value === "string") return value;
  const array = z.array(z.unknown()).safeParse(value);
  return array.success
    ? array.data
        .flatMap((item) => {
          const parsed = textContent.safeParse(item);
          return parsed.success ? [parsed.data.text] : [];
        })
        .join("\n")
    : "";
}
function withoutLineNumbers(text: string) {
  return text.replace(/^\s*\d+[\t→]/gm, "").trim();
}
function normalizedPath(path: string) {
  return path.replace(/^\/private\/tmp\//, "/tmp/");
}
export interface RuntimeEvidence {
  readonly auth?: {
    readonly code: number | null;
    readonly authorizationObserved?: boolean;
    readonly callbackSent?: boolean;
  };
  readonly events?: readonly {
    readonly kind: string;
    readonly pkce?: boolean;
  }[];
  readonly logout?: { readonly code: number | null };
  readonly process?: {
    readonly code: number | null;
    readonly timedOut: boolean;
  };
  readonly projectUnchanged?: boolean;
  readonly failure?: string;
}
export function runtimeFailures(value: RuntimeEvidence): string[] {
  const failures = [];
  if (
    value.auth?.code !== 0 ||
    value.auth.authorizationObserved !== true ||
    value.auth.callbackSent !== true ||
    value.events?.some(
      (event) => event.kind === "token_exchange" && event.pkce === true,
    ) !== true
  )
    failures.push("native_auth_failed");
  if (value.logout?.code !== 0) failures.push("native_logout_failed");
  if (value.process?.code !== 0 || value.process.timedOut)
    failures.push("native_process_incomplete");
  if (value.projectUnchanged !== true)
    failures.push("project_mutated_or_unobserved");
  if (value.failure !== undefined) failures.push("harness_failure");
  return failures;
}
export interface ReadInput {
  readonly path: string;
  readonly absolutePath: string;
  readonly content: string;
}
export function inspectNativeEvidence(client: NativeClient, stdout: string) {
  const failures: string[] = [];
  const transportWarnings: string[] = [];
  const pages: {
    query: z.infer<typeof argsSchema>;
    response: z.infer<typeof page>["value"];
  }[] = [];
  const reads: { path: string; content: string }[] = [];
  const commands: {
    command: string;
    output: string;
    exitCode: number | null | undefined;
  }[] = [];
  let discovery = false;
  let inventory: string[] | undefined;
  const uses = new Map<string, { name: string; input: unknown }>();
  function observeTool(
    name: string,
    input: unknown,
    result: unknown,
    success: boolean,
  ) {
    if (name.endsWith("learning_practice_read")) {
      const parsedArgs = argsSchema.safeParse(input);
      let parsedPage;
      try {
        parsedPage = page.safeParse(JSON.parse(texts(result)));
      } catch {
        failures.push("invalid_mcp_page");
        return;
      }
      if (!success || !parsedArgs.success || !parsedPage.success) {
        failures.push("failed_mcp_page");
        return;
      }
      pages.push({ query: parsedArgs.data, response: parsedPage.data.value });
    }
    if (name === "Read" && success) {
      const args = z.object({ file_path: z.string() }).safeParse(input);
      if (args.success)
        reads.push({ path: args.data.file_path, content: texts(result) });
    }
    if (["Glob", "Grep"].includes(name) && success) discovery = true;
  }
  for (const line of stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)) {
    let value;
    try {
      value = event.safeParse(JSON.parse(line));
    } catch {
      failures.push("malformed_native_event");
      continue;
    }
    if (!value.success) {
      failures.push("malformed_native_event");
      continue;
    }
    const entry = value.data;
    if (entry.type === "error" && typeof entry.message === "string")
      transportWarnings.push(entry.message);
    if (entry.type === "system" && entry.subtype === "init")
      inventory = entry.tools;
    if (
      client === "codex" &&
      entry.type === "item.completed" &&
      entry.item !== undefined
    ) {
      const item = entry.item;
      if (item.type === "mcp_tool_call" && item.tool !== undefined) {
        const result = object.safeParse(item.result);
        observeTool(
          item.tool,
          item.arguments,
          result.success ? result.data["content"] : undefined,
          item.status === "completed",
        );
      }
      if (item.type === "command_execution" && item.command !== undefined) {
        commands.push({
          command: item.command,
          output: item.aggregated_output ?? "",
          exitCode: item.exit_code,
        });
        if (item.exit_code === 0 && /\b(?:ls|find|rg)\b/.test(item.command))
          discovery = true;
      }
    }
    for (const content of typeof entry.message === "object"
      ? entry.message.content
      : []) {
      if (
        content.type === "tool_use" &&
        content.id !== undefined &&
        content.name !== undefined
      )
        uses.set(content.id, { name: content.name, input: content.input });
      if (content.type === "tool_result" && content.tool_use_id !== undefined) {
        const use = uses.get(content.tool_use_id);
        if (use !== undefined)
          observeTool(
            use.name,
            use.input,
            content.content,
            content.is_error !== true,
          );
      }
    }
  }
  return {
    failures,
    pages,
    reads,
    commands,
    discovery,
    inventory,
    transportWarnings,
  };
}
export function validateReviewEvidence(input: {
  client: NativeClient;
  process: NativeProcessResult;
  report: unknown;
  practiceId: string;
  files: readonly ReadInput[];
  expectedContextVersion?: string;
  requireDiscovery?: boolean;
}) {
  const observed = inspectNativeEvidence(input.client, input.process.stdout);
  const failures = [...observed.failures];
  const first = observed.pages.find((row) => row.response.part === 0)?.response;
  if (first === undefined)
    return {
      passed: false,
      failures: [...failures, "missing_context_part_zero"],
      readPaths: [],
    };
  const unique = new Map<number, string>();
  for (const { query, response } of observed.pages) {
    if (
      query.practiceId !== input.practiceId ||
      response.practiceId !== input.practiceId ||
      query.part !== response.part ||
      response.contextVersion !== first.contextVersion ||
      response.contentSha256 !== first.contentSha256 ||
      response.partCount !== first.partCount ||
      response.contentBytes !== first.contentBytes
    )
      failures.push("context_or_content_changed");
    if (
      response.part > 0 &&
      (query.expectedContextVersion !== first.contextVersion ||
        query.expectedContentSha256 !== first.contentSha256)
    )
      failures.push("unpinned_later_part");
    if (
      input.expectedContextVersion !== undefined &&
      query.expectedContextVersion !== input.expectedContextVersion
    )
      failures.push("unpinned_recheck_context");
    if (sha(response.data) !== response.partSha256)
      failures.push("part_digest_mismatch");
    if (
      response.endOfContext !== (response.part === first.partCount - 1) ||
      response.nextPart !==
        (response.part === first.partCount - 1 ? null : response.part + 1)
    )
      failures.push("invalid_part_boundary");
    const prior = unique.get(response.part);
    if (prior !== undefined && prior !== response.data)
      failures.push("conflicting_duplicate_part");
    unique.set(response.part, response.data);
  }
  if (
    unique.size !== first.partCount ||
    Array.from({ length: first.partCount }, (_, i) => i).some(
      (i) => !unique.has(i),
    )
  )
    failures.push("missing_context_parts");
  const joined = Array.from(
    { length: first.partCount },
    (_, i) => unique.get(i) ?? "",
  ).join("");
  if (
    sha(joined) !== first.contentSha256 ||
    Buffer.byteLength(joined) !== first.contentBytes
  )
    failures.push("assembled_context_mismatch");
  let definition;
  try {
    const parsed = context.safeParse(JSON.parse(joined));
    if (parsed.success) definition = parsed.data;
  } catch {
    /* Report malformed assembly below. */
  }
  if (
    definition === undefined ||
    definition.contextVersion !== first.contextVersion ||
    definition.terminalMarker !== `END_CONTEXT:${first.contextVersion}`
  )
    failures.push("missing_context_end_marker");
  const parsedReport = report.safeParse(input.report);
  if (!parsedReport.success) failures.push("invalid_report");
  else if (parsedReport.data.action === "report") {
    if (
      parsedReport.data.contextVersion !== first.contextVersion ||
      parsedReport.data.terminalMarker !==
        `END_CONTEXT:${first.contextVersion}` ||
      JSON.stringify(
        [...(parsedReport.data.partsRead ?? [])].sort((a, b) => a - b),
      ) !== JSON.stringify([...unique.keys()].sort((a, b) => a - b))
    )
      failures.push("report_context_unsubstantiated");
    const expected =
      definition?.payload.practice.definition.criteria
        .map((row) => row.id)
        .sort() ?? [];
    if (
      JSON.stringify(
        parsedReport.data.criteria?.map((row) => row.id).sort(),
      ) !== JSON.stringify(expected)
    )
      failures.push("incomplete_criterion_report");
  } else if (
    parsedReport.data.question === undefined ||
    parsedReport.data.question === null ||
    parsedReport.data.question.trim().length === 0
  )
    failures.push("missing_scope_question");
  const readPaths: string[] = [];
  if (parsedReport.success && parsedReport.data.action === "report")
    for (const file of input.files) {
      const read = observed.reads.some(
        (row) =>
          normalizedPath(row.path) === normalizedPath(file.absolutePath) &&
          withoutLineNumbers(row.content).includes(file.content.trim()),
      );
      const command = observed.commands.some(
        (row) =>
          row.exitCode === 0 &&
          /(?:^|['"\n])(?:\/bin\/)?(?:cat|sed|head|tail)\s/.test(row.command) &&
          row.command.includes(file.path) &&
          withoutLineNumbers(row.output).includes(file.content.trim()),
      );
      if (read || command) readPaths.push(file.path);
      else failures.push(`current_file_not_read:${file.path}`);
    }
  if (
    input.requireDiscovery === true &&
    !observed.discovery &&
    observed.reads.length === 0
  )
    failures.push("project_not_inspected");
  return {
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    contextVersion: first.contextVersion,
    contentSha256: first.contentSha256,
    parts: [...unique.keys()].sort((a, b) => a - b),
    protocolVersion: definition?.payload.reviewProtocol.version,
    transportWarnings: observed.transportWarnings,
    readPaths,
  };
}
export function classifyWriteProbe(
  client: NativeClient,
  process: NativeProcessResult,
) {
  const observed = inspectNativeEvidence(client, process.stdout);
  if (process.code !== 0 || process.timedOut || observed.failures.length > 0)
    return "inconclusive" as const;
  if (
    observed.commands.some(
      (row) =>
        row.exitCode !== 0 &&
        row.command.includes("sentinel.txt") &&
        /(?:>|tee\s)/.test(row.command) &&
        /operation not permitted|permission denied/i.test(row.output),
    )
  )
    return "tool-denied" as const;
  if (
    client === "claude" &&
    observed.inventory !== undefined &&
    observed.inventory.length > 0 &&
    observed.inventory.every(
      (name) =>
        ["Read", "Glob", "Grep"].includes(name) ||
        /^mcp__[^_]+(?:_[^_]+)*__learning_(?:material_read|materials_list|practice_read)$/.test(
          name,
        ),
    )
  )
    return "tools-unavailable" as const;
  return "inconclusive" as const;
}
