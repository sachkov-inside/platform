import { processDeadline } from "./process-deadline.mjs";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type NativeClient = "codex" | "claude";
export interface NativeReviewInput {
  readonly client: NativeClient;
  readonly serverName: string;
  readonly serverUrl: string;
  readonly mcpConfigPath: string;
  readonly projectDir: string;
  readonly prompt: string;
  readonly outputPath: string;
  readonly timeoutMs?: number;
  readonly outputMode?: "json" | "text";
  /**
   * The tested profile. `practice-v2` reads only and exposes one practice tool. `task-v3` (#946)
   * exposes the four Product Task tools and a shell, because procedure v3 lets the learner consent to
   * one named command; writes to the project stay outside the profile.
   */
  readonly profile?: "practice-v2" | "task-v3";
}

/** The learner MCP tools each profile exposes. */
export const profileTools = {
  "practice-v2": ["learning_practice_read"],
  "task-v3": [
    "learning_tasks_list",
    "learning_task_read",
    "learning_task_submit",
    "learning_task_submissions",
  ],
} as const;
export interface NativeProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly streamTimeline?: readonly {
    at: string;
    stream: "stdout" | "stderr";
    offsetChars: number;
    lengthChars: number;
  }[];
}
export async function runNativeReview({
  client,
  serverName,
  serverUrl,
  mcpConfigPath,
  projectDir,
  prompt,
  outputPath,
  timeoutMs = 240000,
  outputMode = "json",
  profile = "practice-v2",
}: NativeReviewInput): Promise<NativeProcessResult> {
  const tools = profileTools[profile];
  const shell = profile === "task-v3";
  const settings = {
    disableAllHooks: true,
    disableClaudeAiConnectors: true,
    autoMemoryEnabled: false,
    claudeMdExcludes: ["**"],
    pluginConfigs: {
      "agents-md@builtin": { options: { instructionFiles: "managed-only" } },
    },
  };
  const codex = [
    "--no-daemon",
    "--ask-for-approval",
    "never",
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--cd",
    projectDir,
    ...(outputMode === "json"
      ? ["--json"]
      : ["--output-last-message", outputPath + ".last.txt"]),
    "--model",
    "gpt-6-astra",
    ...[
      "hooks",
      "plugins",
      "apps",
      "multi_agent",
      "multi_agent_v2",
      "memories",
      "shell_snapshot",
      "browser_use",
      "browser_use_external",
      "computer_use",
      "image_generation",
    ].flatMap((name) => ["--disable", name]),
    "--enable",
    "skip_host_skill_discovery",
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    'web_search="disabled"',
    "-c",
    "allow_login_shell=false",
    "-c",
    'shell_environment_policy.inherit="none"',
    "-c",
    // A v3 learner may consent to a Node command, so that profile's shell finds this Node.
    `shell_environment_policy.set={PATH=${JSON.stringify(
      [
        ...(shell ? [dirname(process.execPath)] : []),
        "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
      ].join(":"),
    )},ZDOTDIR="/dev/null",BASH_ENV="/dev/null"}`,
    "-c",
    `projects.${JSON.stringify(projectDir)}.trust_level="untrusted"`,
    "-c",
    `mcp_servers.${serverName}.url=${JSON.stringify(serverUrl)}`,
    "-c",
    `mcp_servers.${serverName}.required=true`,
    "-c",
    `mcp_servers.${serverName}.enabled_tools=${JSON.stringify(tools)}`,
    "-c",
    'mcp_oauth_credentials_store="keyring"',
    "-",
  ];
  const claude = [
    "--restricted",
    "--print",
    "--model",
    "claude-opus-5-5",
    "--setting-sources",
    "",
    "--settings",
    JSON.stringify(settings),
    "--mcp-config",
    mcpConfigPath,
    "--strict-mcp-config",
    "--tools",
    shell ? "Read,Glob,Grep,Bash" : "Read,Glob,Grep",
    "--allowedTools",
    [
      "Read",
      "Glob",
      "Grep",
      ...(shell ? ["Bash"] : []),
      ...tools.map((tool) => `mcp__${serverName}__${tool}`),
    ].join(","),
    "--disallowedTools",
    shell
      ? "PowerShell,Edit,Write,NotebookEdit,Agent,Task,WebFetch,WebSearch"
      : "Bash,PowerShell,Edit,Write,NotebookEdit,Agent,Task,WebFetch,WebSearch",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--disable-slash-commands",
    "--no-chrome",
    "--no-session-persistence",
    "--output-format",
    ...(outputMode === "json" ? ["stream-json", "--verbose"] : ["text"]),
  ];
  const args = client === "codex" ? codex : claude;
  const result = await new Promise<NativeProcessResult>((resolve, reject) => {
    const p = spawn(client, args, {
      cwd: projectDir,
      env: {
        ...process.env,
        MCP_PROTOCOL_NEGOTIATION: "legacy",
        SHELL: "/bin/bash",
        BASH_ENV: "/dev/null",
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "",
      stderr = "";
    const deadline = processDeadline(p, timeoutMs);
    const streamTimeline: {
      at: string;
      stream: "stdout" | "stderr";
      offsetChars: number;
      lengthChars: number;
    }[] = [];
    p.stdout.on("data", (chunk) => {
      const text = String(chunk);
      streamTimeline.push({
        at: new Date().toISOString(),
        stream: "stdout",
        offsetChars: stdout.length,
        lengthChars: text.length,
      });
      stdout += text;
    });
    p.stderr.on("data", (chunk) => {
      const text = String(chunk);
      streamTimeline.push({
        at: new Date().toISOString(),
        stream: "stderr",
        offsetChars: stderr.length,
        lengthChars: text.length,
      });
      stderr += text;
    });
    p.on("error", (error) => {
      deadline.dispose();
      reject(error);
    });
    p.on("close", (code, signal) => {
      deadline.dispose();
      resolve({
        code,
        signal,
        timedOut: deadline.timedOut,
        stdout,
        stderr,
        streamTimeline,
      });
    });
    p.stdin.end(prompt);
  });
  await writeFile(outputPath, JSON.stringify(result, null, 2));
  return result;
}
