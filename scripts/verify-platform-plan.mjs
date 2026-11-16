// @ts-check
import { z } from "zod";
import { lightInstanceName, lightRoleNames } from "./stand-light-plan.mjs";

/**
 * Decisions of the `verify-platform` helper: which browser session a verifier drives, whether a
 * light instance is worth driving, what may be read from its database and where evidence goes.
 * `verify-platform.mjs` gathers the facts and runs the commands.
 */

/** A role that signs in on a light instance. */
export const signedInRoleSchema = z.enum(lightRoleNames);
/** A browser session: a signed-in role, or the guest who never signs in. */
export const verifyRoleSchema = z.enum([...lightRoleNames, "guest"]);
/** What `address` can point at. */
export const addressTargetSchema = z.enum([
  ...lightRoleNames,
  "sign-out",
  "web",
  "api",
]);

/** @typedef {z.infer<typeof verifyRoleSchema>} VerifyRole */

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
 * @param {z.infer<typeof addressTargetSchema>} target
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
  if (bytes < 1000) return `${String(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** GitHub attaches an image or a video of at most 10 MB to a pull request. */
const attachmentBytes = 10_000_000;
/** One clip per scenario; 10–30 s is the aim, and longer than this is a whole run in one file. */
const longestClipSeconds = 30;

/** @param {string} path */
export function isClip(path) {
  return /\.(?:webm|mp4|mov)$/iu.test(path);
}

export const verdictSchema = z.enum(["PASS", "PASS+NOTES", "FAIL"]);
/** A clip for motion, a screenshot for one moment, a table for what no screen shows, numbers for speed. */
export const evidenceKindSchema = z.enum([
  "video",
  "screenshot",
  "table",
  "numbers",
  "none",
]);
export const evidenceSourceSchema = z.enum([
  "light-instance",
  "stand-test-data",
]);
const oneLine = z
  .string()
  .trim()
  .min(1)
  .refine((text) => !/[\r\n]/u.test(text), "must be one line");
const scenarioSchema = z.strictObject({
  id: z.string().regex(/^s\d{2,}$/u),
  /** What was checked, in one line. */
  title: oneLine,
  kind: evidenceKindSchema,
  files: z.array(
    z.strictObject({
      /** A file inside `.evidence`. */
      path: z
        .string()
        .min(1)
        .refine(
          (path) => !path.startsWith("/") && !path.split("/").includes(".."),
          "must stay inside .evidence",
        ),
      shows: oneLine,
    }),
  ),
  /** What the evidence shows, or the result in words when no file is kept. */
  shows: oneLine,
  source: evidenceSourceSchema,
  /** The change this scenario covers. */
  covers: oneLine,
  result: verdictSchema,
  notes: z.string().nullable(),
});

/**
 * `.evidence/manifest.json`: everything a reader needs to present the run, with no other source.
 */
export const manifestSchema = z.strictObject({
  version: z.literal(1),
  commit: z.string(),
  branch: z.string(),
  base: z.string().nullable(),
  patchId: z.string().nullable(),
  uncommittedFiles: z.array(z.string()),
  uncommittedDiffSha256: z.string().nullable(),
  startedAt: z.string(),
  verdict: verdictSchema.nullable(),
  notes: z.string().nullable(),
  scenarios: z.array(scenarioSchema),
});

/** @typedef {z.infer<typeof manifestSchema>} Manifest */
/** @typedef {Omit<z.infer<typeof scenarioSchema>, "id">} ScenarioInput */

/**
 * @param {Pick<Manifest, "commit" | "branch" | "base" | "patchId" | "uncommittedFiles" | "uncommittedDiffSha256" | "startedAt">} run
 * @returns {Manifest}
 */
export function newManifest(run) {
  return { version: 1, ...run, verdict: null, notes: null, scenarios: [] };
}

/**
 * @param {Manifest} manifest @param {ScenarioInput} input
 * @returns {Manifest}
 */
export function addScenario(manifest, input) {
  const parsed = scenarioSchema.safeParse({
    ...input,
    id: `s${String(manifest.scenarios.length + 1).padStart(2, "0")}`,
  });
  if (!parsed.success)
    throw new Error(
      `The scenario is incomplete: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
    );
  const mismatch = kindMismatch(parsed.data);
  if (mismatch !== undefined) throw new Error(mismatch);
  if (parsed.data.source === "stand-test-data" && parsed.data.kind !== "none")
    throw new Error(
      "a scenario from the shared stand keeps no file: use kind none and say the result in --shows",
    );
  return { ...manifest, scenarios: [...manifest.scenarios, parsed.data] };
}

/**
 * @param {Pick<z.infer<typeof scenarioSchema>, "kind" | "files">} scenario
 * @returns {string | undefined} why the files do not fit the kind of evidence
 */
function kindMismatch({ kind, files }) {
  if (kind === "none")
    return files.length > 0
      ? "a scenario of kind none takes no files; say the result in --shows"
      : undefined;
  if (files.length === 0)
    return `a scenario of kind ${kind} needs at least one file`;
  const clips = files.filter((file) => isClip(file.path)).length;
  if (kind === "video" && clips !== files.length)
    return "a scenario of kind video takes clips: .webm, .mp4 or .mov";
  if (kind !== "video" && clips > 0)
    return `a scenario of kind ${kind} takes no clip; use kind video for it`;
  return undefined;
}

/**
 * @param {Manifest} manifest
 * @param {Record<string, { bytes: number; seconds: number | null } | undefined>} files facts
 *   about each named file; a missing key is a missing file, `seconds` is a clip's length
 * @returns {string[]} what stops the manifest from being presented; empty when it is complete
 */
export function manifestProblems(manifest, files) {
  /** @type {string[]} */
  const problems = [];
  if (manifest.scenarios.length === 0) return ["the run has no scenarios"];
  const ids = new Set();
  for (const item of manifest.scenarios) {
    if (ids.has(item.id)) problems.push(`${item.id}: the id is used twice`);
    ids.add(item.id);
    const mismatch = kindMismatch(item);
    if (mismatch !== undefined) problems.push(`${item.id}: ${mismatch}`);
    if (item.result !== "PASS" && !item.notes && !manifest.notes)
      problems.push(`${item.id}: the result ${item.result} needs notes`);
    for (const { path } of item.files) {
      const fact = files[path];
      if (fact === undefined) {
        problems.push(`${item.id}: ${path} is not a file in .evidence`);
        continue;
      }
      if (fact.bytes === 0) problems.push(`${item.id}: ${path} is empty`);
      if (fact.bytes > attachmentBytes)
        problems.push(
          `${item.id}: ${path} is ${size(fact.bytes)}; GitHub attaches at most 10 MB`,
        );
      if (!isClip(path)) continue;
      if (fact.seconds === null)
        problems.push(
          `${item.id}: the length of ${path} is unknown; install ffprobe or check it by hand`,
        );
      else if (fact.seconds > longestClipSeconds)
        problems.push(
          `${item.id}: ${path} lasts ${String(Math.round(fact.seconds))} s; record one clip of at most ${String(longestClipSeconds)} s per scenario`,
        );
    }
  }
  if (manifest.verdict === null)
    problems.push(
      "the run has no verdict; set it with: evidence verdict <PASS|PASS+NOTES|FAIL>",
    );
  else {
    const worse = manifest.scenarios.find((item) =>
      manifest.verdict === "PASS"
        ? item.result !== "PASS"
        : manifest.verdict === "PASS+NOTES" && item.result === "FAIL",
    );
    if (worse !== undefined)
      problems.push(
        `the verdict is ${manifest.verdict} but scenario ${worse.id} is ${worse.result}`,
      );
    if (manifest.verdict !== "PASS" && !manifest.notes)
      problems.push(`the verdict ${manifest.verdict} needs notes`);
  }
  return problems;
}

/** @param {Manifest} manifest */
export function manifestReport(manifest) {
  return [
    `Verdict: ${manifest.verdict ?? "<PASS | PASS+NOTES | FAIL>"}`,
    "",
    `- Commit: \`${manifest.commit}\` on \`${manifest.branch || "detached HEAD"}\``,
    `- Patch: ${manifest.base === null ? "base origin/main is unknown" : manifest.patchId === null ? `no commits beyond \`${manifest.base}\`` : `\`${manifest.base.slice(0, 12)}..${manifest.commit.slice(0, 12)}\`, patch-id \`${manifest.patchId}\``}`,
    `- Uncommitted: ${manifest.uncommittedFiles.length === 0 ? "none" : `${String(manifest.uncommittedFiles.length)} file(s), diff sha256 \`${manifest.uncommittedDiffSha256 ?? ""}\`: ${manifest.uncommittedFiles.join(", ")}`}`,
    `- Notes: ${manifest.notes ?? "none"}`,
    "",
    "| Scenario | Checked | Evidence | Files | Data | Result |",
    "|---|---|---|---|---|---|",
    ...manifest.scenarios.map(
      (item) =>
        `| ${item.id} | ${item.title} | ${item.kind} | ${item.files.map((file) => `\`${file.path}\``).join(", ") || "none"} | ${item.source} | ${item.result} |`,
    ),
    "",
    ...manifest.scenarios.flatMap((item) => [
      `- ${item.id} covers: ${item.covers}. Shows: ${item.shows}${item.notes ? `. Notes: ${item.notes}` : ""}`,
      ...item.files.map((file) => `  - \`${file.path}\`: ${file.shows}`),
    ]),
  ].join("\n");
}
