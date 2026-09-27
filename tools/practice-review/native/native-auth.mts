import { processDeadline } from "./process-deadline.mjs";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

import type { NativeClient } from "./client-process.mjs";
interface LoginResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly authorizationObserved: boolean;
  readonly callbackSent: boolean;
  readonly problem: string;
  readonly output: string;
}
export interface NativeAuthInput {
  readonly client: NativeClient;
  readonly name: string;
  readonly serverUrl: string;
  readonly issuer: string;
  readonly directory: string;
}
export async function nativeAuth({
  client,
  name,
  serverUrl,
  issuer,
  directory,
}: NativeAuthInput) {
  const configPath = `${directory}/.mcp.json`;
  await writeFile(
    configPath,
    JSON.stringify({
      mcpServers: { [name]: { type: "http", url: serverUrl } },
    }),
  );
  const codexConfig = [
    "--disable",
    "hooks",
    "--disable",
    "plugins",
    "-c",
    `mcp_servers.${name}.url=${JSON.stringify(serverUrl)}`,
    "-c",
    'mcp_oauth_credentials_store="keyring"',
  ];
  const claudeConfig = [
    "--settings",
    '{"disableAllHooks":true,"disableClaudeAiConnectors":true,"enableAllProjectMcpServers":true,"autoMemoryEnabled":false}',
  ];
  const config = client === "codex" ? codexConfig : claudeConfig;
  const args = [
    ...config,
    "mcp",
    "login",
    name,
    "--no-browser",
    ...(client === "codex" ? ["--oauth-client-registration", "dcr"] : []),
  ];
  const login = await new Promise<LoginResult>((resolve, reject) => {
    const child = spawn(
      client === "claude" ? "python3" : client,
      client === "claude"
        ? [
            "-I",
            "-c",
            "import pty,sys,os; sys.exit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:])))",
            client,
            ...args,
          ]
        : args,
      {
        cwd: directory,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      },
    );
    let collected = "",
      handled = false,
      callbackSent = false,
      problem = "";
    const deadline = processDeadline(child, 60000);
    const stop = () => {
      deadline.stop();
    };
    const consume = (chunk: Buffer) => {
      collected += String(chunk);
      const url = [
        ...Array.from(collected, (character) =>
          character.charCodeAt(0) < 32 ? " " : character,
        )
          .join("")
          .matchAll(/http:\/\/127\.0\.0\.1:\d+\/authorize\?[^\s]+/g),
      ][0]?.[0];
      if (url !== undefined && !handled) {
        handled = true;
        void (async () => {
          const target = new URL(url);
          if (target.origin !== issuer)
            throw Error("Unexpected synthetic authorization host");
          const response = await fetch(target, { redirect: "manual" });
          const location = response.headers.get("location");
          if (location === null) throw Error("Missing synthetic callback");
          const callback = new URL(location);
          if (
            !["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname) ||
            callback.protocol !== "http:"
          )
            throw Error("Non-local callback");
          child.stdin.write(location + "\n");
          callbackSent = true;
        })().catch(() => {
          problem = "Synthetic authorization failed";
          stop();
        });
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", (error) => {
      deadline.dispose();
      reject(error);
    });
    child.on("close", (code, signal) => {
      deadline.dispose();
      resolve({
        code,
        signal,
        authorizationObserved: handled,
        callbackSent,
        problem: deadline.timedOut ? "timeout" : problem,
        output: collected
          .replace(/https?:\/\/[^\s]+/g, "[URL]")
          .replace(/[A-Za-z0-9_-]{80,}/g, "[redacted]"),
      });
    });
  });
  return {
    login,
    configPath,
    async logout() {
      return await new Promise<{ code: number | null; error?: string }>(
        (resolve) => {
          const p = spawn(client, [...config, "mcp", "logout", name], {
            cwd: directory,
            stdio: "ignore",
            detached: true,
          });
          const deadline = processDeadline(p, 30000);
          p.on("error", () => {
            deadline.dispose();
            resolve({ code: null, error: "spawn_failed" });
          });
          p.on("close", (code) => {
            deadline.dispose();
            resolve({ code });
          });
        },
      );
    },
  };
}
