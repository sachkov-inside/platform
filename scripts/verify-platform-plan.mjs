// @ts-check
import { lightInstanceName } from "./stand-light-plan.mjs";

/**
 * Decisions of the `verify-platform` helper: which browser session a verifier drives, whether a
 * light instance is worth driving, what may be read from its database and where evidence goes.
 * `verify-platform.mjs` gathers the facts and runs the commands.
 */

/** @typedef {"owner" | "learner" | "guest"} VerifyRole */

/** @type {readonly VerifyRole[]} */
export const verifyRoles = ["owner", "learner", "guest"];

/**
 * Chrome for Testing 154 on macOS 27 binds a random local port before connecting and then fails
 * every connection to 127.0.0.1 with ERR_ADDRESS_INVALID (os error 49). Naming the feature list
 * replaces agent-browser's own `--disable-features=Translate`, so it is repeated here.
 */
const browserLaunchArguments =
  "--disable-features=Translate,TcpPortRandomizationMac";

const proxyVariables = new Set([
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
]);

/** Options that would reach, or launch, a browser other than this session's own. */
const foreignBrowserOptions = new Set([
  "--session",
  "--session-name",
  "--namespace",
  "--all",
  "--cdp",
  "--auto-connect",
  "--profile",
  "--provider",
  "-p",
  "--state",
  "--restore",
  "--executable-path",
  "--config",
  "--headed",
  "--args",
  "--engine",
  "--proxy",
  "--extension",
]);

/**
 * The page commands a verifier needs. The command comes first, so no global option can precede
 * it; `batch`, `connect`, `kill-all`, `upgrade` and the rest are refused by absence.
 */
const browserCommands = new Set([
  "open",
  "snapshot",
  "read",
  "get",
  "find",
  "click",
  "dblclick",
  "fill",
  "type",
  "press",
  "keyboard",
  "select",
  "check",
  "uncheck",
  "hover",
  "focus",
  "scroll",
  "scrollintoview",
  "drag",
  "upload",
  "wait",
  "set",
  "eval",
  "screenshot",
  "record",
  "reload",
  "back",
  "forward",
  "tab",
  "frame",
  "dialog",
  "console",
  "errors",
  "network",
  "cookies",
  "close",
]);

/** The only agent-browser setting taken from the caller's environment. */
const browserNamespaceVariable = "AGENT_BROWSER_NAMESPACE";

/**
 * One browser session per worktree and role: each has its own cookies, so the owner and the
 * learner stay signed in side by side and two worktrees never share a page.
 * @param {string} worktree the real path of the worktree
 * @param {VerifyRole} role
 */
export function verifySessionName(worktree, role) {
  const name =
    worktree
      .split("/")
      .at(-1)
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .slice(0, 12)
      .replace(/^-|-$/gu, "") || "worktree";
  // agent-browser puts the name into a Unix socket path, which holds 103 bytes in all.
  return `verify-${name}-${lightInstanceName(worktree).id}-${role}`;
}

/**
 * @param {object} input
 * @param {string} input.worktree
 * @param {VerifyRole} input.role
 * @param {readonly string[]} input.args the agent-browser command and its arguments
 * @param {NodeJS.Dict<string>} input.environment
 * @returns {{ command: string; args: string[]; environment: Record<string, string> }}
 */
export function browserInvocation({ worktree, role, args, environment }) {
  const command = args[0];
  if (command === undefined || !browserCommands.has(command))
    throw new Error(
      `Start with a page command such as open, snapshot, find, click, wait, screenshot or record${command === undefined ? "" : `, not ${command}`}`,
    );
  const foreign = args.find((item) =>
    foreignBrowserOptions.has(item.split("=")[0] ?? item),
  );
  if (foreign !== undefined)
    throw new Error(
      `${foreign} leaves this worktree's own session; the helper drives only ${verifySessionName(worktree, role)}`,
    );
  const namespace = environment[browserNamespaceVariable]?.trim();
  /** @type {Record<string, string>} */
  const kept = {};
  for (const [key, value] of Object.entries(environment))
    // Other AGENT_BROWSER_* settings could attach the session to another browser or profile.
    if (
      value !== undefined &&
      !proxyVariables.has(key.toLowerCase()) &&
      !key.startsWith("AGENT_BROWSER_")
    )
      kept[key] = value;
  return {
    command: "agent-browser",
    args: [
      ...(namespace ? ["--namespace", namespace] : []),
      "--session",
      verifySessionName(worktree, role),
      "--args",
      browserLaunchArguments,
      ...args,
    ],
    environment: kept,
  };
}

/**
 * @param {{ web: string; api: string; signIn: string | null }} urls addresses of the instance
 * @param {"owner" | "learner" | "sign-out" | "web" | "api"} target
 * @param {string} path a path of this instance, starting with one slash
 */
export function addressFor(urls, target, path) {
  if (!/^\/(?![/\\])/u.test(path))
    throw new Error(`${path} is not a path of this instance; start it with /`);
  if (target === "web" || target === "api")
    return `${urls[target].replace(/\/$/u, "")}${path}`;
  if (urls.signIn === null)
    throw new Error("The instance has no sign-in address yet");
  const next = encodeURIComponent(path);
  return target === "sign-out"
    ? `${urls.signIn.replace(/\/sign-in$/u, "/sign-out")}?next=${next}`
    : `${urls.signIn}?as=${target}&next=${next}`;
}

/**
 * What `next build` reads: the web application, the workspace packages and the dependency set.
 * The API reloads its own source, and documents, skills and root scripts reach neither.
 * @param {string} path a repository path
 */
export function webBuildInput(path) {
  return (
    path.startsWith("apps/web/") ||
    path.startsWith("packages/") ||
    path.startsWith("patches/") ||
    path === "pnpm-lock.yaml" ||
    path === "pnpm-workspace.yaml" ||
    path === "package.json" ||
    path === ".env.example" ||
    /^tsconfig[^/]*\.json$/u.test(path)
  );
}

/**
 * The production build of web is made once, at `up`; the API reloads. A commit, checkout or edit
 * after the start therefore leaves web showing older source than the verdict would name.
 * @param {object} input
 * @param {"production" | "development"} input.web
 * @param {string} input.startedAt ISO time the instance started
 * @param {number} input.headMovedAtMs when HEAD last changed
 * @param {readonly { path: string; modifiedAtMs: number | null }[]} input.changedFiles files that
 *   differ from HEAD or were written after the start; a deleted file has no modification time
 * @returns {{ ok: boolean; detail: string }}
 */
export function sourceFreshness({
  web,
  startedAt,
  headMovedAtMs,
  changedFiles,
}) {
  if (web === "development")
    return { ok: true, detail: "next dev reloads source edits" };
  const started = Date.parse(startedAt);
  if (headMovedAtMs > started)
    return {
      ok: false,
      detail:
        "HEAD moved after the instance started; restart it with pnpm stand:light down and up",
    };
  const built = changedFiles.filter((file) => webBuildInput(file.path));
  const later = built
    .filter((file) => file.modifiedAtMs === null || file.modifiedAtMs > started)
    .map((file) => file.path);
  if (later.length > 0)
    return {
      ok: false,
      detail: `changed after the instance started: ${later.slice(0, 5).join(", ")}${later.length > 5 ? ` and ${String(later.length - 5)} more` : ""}; restart it with pnpm stand:light down and up`,
    };
  return {
    ok: true,
    detail:
      built.length === 0
        ? "web is built from HEAD; no uncommitted change reaches the build"
        : `web is built from HEAD plus ${String(built.length)} uncommitted file(s), all older than the start`,
  };
}

/**
 * @param {readonly { pid: number; ppid: number }[]} table
 * @param {number | undefined} listener the process listening on the port
 * @param {number} supervisor the instance supervisor
 */
export function listenerOwned(table, listener, supervisor) {
  const seen = new Set();
  let pid = listener;
  while (pid !== undefined && !seen.has(pid)) {
    if (pid === supervisor) return true;
    seen.add(pid);
    const current = pid;
    pid = table.find((row) => row.pid === current)?.ppid;
  }
  return false;
}

/**
 * Names of functions that act on the server or its sessions even inside a read-only transaction,
 * wherever they stand: quoting, a schema prefix or a comment before the bracket hide a call.
 * System catalogues (`pg_*`) go with them; a side effect is read from the application's tables.
 */
const actingNames =
  /pg_|set_config|setval|nextval|lo_[a-z]|dblink|query_to_xml|\/\*|--/iu;

/**
 * A side-effect check reads rows. The statement must start as a query, name no function that acts
 * on the server, and runs in a read-only transaction, where a data-modifying `with` fails.
 * @param {string} sql
 */
export function readOnlyStatement(sql) {
  const statement = sql.trim().replace(/;\s*$/u, "");
  if (
    !/^(?:select|with|table|values|show|explain)\b/iu.test(statement) ||
    statement.includes(";") ||
    actingNames.test(statement)
  )
    throw new Error(
      "The database helper runs one reading statement: select, with, table, values, show or explain, over application tables, without pg_* names, sequence or configuration functions, or comments",
    );
  return statement;
}

/**
 * @param {{ now: Date; branch: string; commit: string }} input
 */
export function evidenceRunName({ now, branch, commit }) {
  const time = now
    .toISOString()
    .replace(/\.\d+Z$/u, "Z")
    .replace(/[-:]/gu, "");
  const label =
    branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 60) || "detached";
  return `${time}-${label}-${commit.slice(0, 7)}`;
}

/**
 * @param {readonly { name: string; ok: boolean; detail: string }[]} checks
 * @returns {{ ok: boolean; text: string }}
 */
export function doctorReport(checks) {
  const ok = checks.length > 0 && checks.every((check) => check.ok);
  return {
    ok,
    text: [
      ...checks.map(
        (check) =>
          `${check.ok ? "ok    " : "FAIL  "}${check.name}: ${check.detail}`,
      ),
      ok
        ? "The instance is worth driving."
        : "Do not drive this instance: fix the failed checks first.",
    ].join("\n"),
  };
}

/** @param {number} bytes */
function size(bytes) {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * @param {readonly { path: string; bytes: number; sha256: string }[]} files
 */
export function artifactTable(files) {
  if (files.length === 0) return "No artifacts.";
  return [
    "| Artifact | Size | SHA-256 |",
    "|---|---|---|",
    ...files.map(
      (file) =>
        `| \`${file.path}\` | ${size(file.bytes)} | \`${file.sha256.slice(0, 12)}\` |`,
    ),
  ].join("\n");
}
