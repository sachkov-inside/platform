// @ts-check
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const marker = "<!-- platform-review-evidence:v1 -->";
const sha = /^[a-f0-9]{40}$/u;
/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** @param {unknown} value */
function object(value) {
  requireValue(isObject(value), "Expected an object");
  return value;
}
/** @param {unknown} value @returns {unknown[]} */
function array(value) {
  requireValue(Array.isArray(value), "Expected an array");
  return /** @type {unknown[]} */ (value);
}
/** @param {Record<string, unknown>} value @param {string} key @param {boolean} [allowEmpty] */
function stringField(value, key, allowEmpty = false) {
  const field = value[key];
  requireValue(
    typeof field === "string" && (allowEmpty || field.trim().length > 0),
    `Missing string: ${key}`,
  );
  return field;
}
/** @param {Record<string, unknown>} value @param {string} key */
function numberField(value, key) {
  const field = value[key];
  requireValue(
    typeof field === "number" && Number.isSafeInteger(field) && field > 0,
    `Missing positive integer: ${key}`,
  );
  return field;
}
/** @param {Record<string, unknown>} value @param {string[]} expected */
function keys(value, expected) {
  requireValue(
    Object.keys(value).sort().join() === [...expected].sort().join(),
    "Unexpected or missing receipt fields",
  );
}
/** @param {unknown} input */
export function taskDigest(input) {
  const task = object(input);
  requireValue(!task["pull_request"], "Task must be an issue");
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: stringField(task, "title", true),
        body: stringField(task, "body", true),
      }),
    )
    .digest("hex");
}
/** @param {unknown} input */
export function validateReceipt(input) {
  const value = object(input);
  keys(value, [
    "schemaVersion",
    "repository",
    "pullRequest",
    "task",
    "taskSha256",
    "baseSha",
    "headSha",
    "implementer",
    "reviews",
  ]);
  requireValue(value["schemaVersion"] === 1, "Unsupported receipt version");
  const repository = stringField(value, "repository");
  const task = stringField(value, "task");
  const taskSha256 = stringField(value, "taskSha256");
  const baseSha = stringField(value, "baseSha");
  const headSha = stringField(value, "headSha");
  requireValue(/^[\w.-]+\/[\w.-]+$/u.test(repository), "Invalid repository");
  requireValue(
    task["startsWith"](`https://github.com/${repository}/issues/`) &&
      /^[1-9]\d*$/u.test(task["split"]("/").at(-1) ?? ""),
    "Invalid task",
  );
  requireValue(
    /^[a-f0-9]{64}$/u.test(taskSha256),
    "Missing immutable task digest",
  );
  requireValue(
    sha.test(baseSha) && sha.test(headSha),
    "Expected immutable base/head",
  );
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Set<string>} */
  const transcripts = new Set();
  /** @param {Record<string, unknown>} agent */
  function identity(agent) {
    const agentId = stringField(agent, "agentId");
    const transcript = stringField(agent, "transcript");
    requireValue(
      agentId === agentId.trim() && transcript === transcript.trim(),
      "Noncanonical identity/transcript",
    );
    requireValue(
      !ids.has(agentId) && !transcripts.has(transcript),
      "Duplicate reviewer or implementer identity/transcript",
    );
    ids.add(agentId);
    transcripts.add(transcript);
    return { agentId, transcript };
  }
  const author = object(value["implementer"]);
  keys(author, ["agentId", "transcript"]);
  const implementer = identity(author);
  const rawReviews = array(value["reviews"]);
  requireValue(rawReviews.length === 2, "Require two independent reviews");
  /** @type {Set<string>} */
  const roles = new Set();
  const reviews = rawReviews.map((raw) => {
    const review = object(raw);
    keys(review, [
      "role",
      "agentId",
      "transcript",
      "outcome",
      "findingsComplete",
      "findings",
    ]);
    const role = stringField(review, "role");
    requireValue(
      ["Standards", "Spec"].includes(role) && !roles.has(role),
      "Require separate Standards and Spec",
    );
    roles.add(role);
    const reviewer = identity(review);
    requireValue(
      review["outcome"] === "passed" && review["findingsComplete"] === true,
      "Review incomplete or blocked",
    );
    /** @type {Set<string>} */
    const findingIds = new Set();
    const findings = array(review["findings"]).map((rawFinding) => {
      const finding = object(rawFinding);
      keys(finding, ["id", "severity", "disposition", "reason", "evidence"]);
      const id = stringField(finding, "id");
      const severity = stringField(finding, "severity");
      const disposition = stringField(finding, "disposition");
      requireValue(!findingIds.has(id), "Duplicate finding ID");
      findingIds.add(id);
      requireValue(
        ["blocking", "nonblocking"].includes(severity),
        "Invalid finding severity",
      );
      requireValue(
        ["fixed", "rejected", "deferred"].includes(disposition),
        "Incomplete finding disposition",
      );
      requireValue(
        severity !== "blocking" || disposition !== "deferred",
        "Unresolved blocking finding",
      );
      return {
        id,
        severity,
        disposition,
        reason: stringField(finding, "reason"),
        evidence: stringField(finding, "evidence"),
      };
    });
    return {
      role,
      ...reviewer,
      outcome: "passed",
      findingsComplete: true,
      findings,
    };
  });
  return {
    schemaVersion: 1,
    repository,
    pullRequest: numberField(value, "pullRequest"),
    task,
    taskSha256,
    baseSha,
    headSha,
    implementer,
    reviews,
  };
}
/** @param {...string} args */
function git(...args) {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}
/**
 * True when `commit` has one parent and its tree is the conflict-free merge of `head` into that
 * parent, which is how a squash merge queue builds an entry.
 * @param {string} commit @param {string} head
 */
function squashOf(commit, head) {
  if (!sha.test(head)) return false;
  const parents = git("rev-list", "--parents", "-n", "1", commit).split(" ");
  if (parents.length !== 2 || parents[1] === undefined) return false;
  requireValue(
    git("cat-file", "-t", head) === "commit",
    "Reviewed PR head is missing from the candidate checkout",
  );
  let merged;
  try {
    merged = git("merge-tree", "--write-tree", parents[1], head);
  } catch {
    return false;
  }
  return sha.test(merged) && merged === git("rev-parse", `${commit}^{tree}`);
}
/** @param {string} base @param {string} head */
function ancestor(base, head) {
  try {
    git("merge-base", "--is-ancestor", base, head);
    return true;
  } catch {
    return false;
  }
}
/** @param {Awaited<ReturnType<typeof verify>>} result */
function output(result) {
  const message = JSON.stringify(result);
  console.log(message);
  if (process.env["GITHUB_OUTPUT"])
    appendFileSync(process.env["GITHUB_OUTPUT"], `status=${result.status}\n`);
  if (process.env["GITHUB_STEP_SUMMARY"])
    appendFileSync(
      process.env["GITHUB_STEP_SUMMARY"],
      `Review evidence: ${message}\n`,
    );
}
/** @param {{event: unknown, repository: string, eventName: string, candidate: string, token: string, request?: typeof fetch}} options */
export async function verify({
  event,
  repository,
  eventName,
  candidate,
  token,
  request = fetch,
}) {
  requireValue(/^[\w.-]+\/[\w.-]+$/u.test(repository), "Invalid repository");
  requireValue(sha.test(candidate), "Missing immutable candidate");
  requireValue(token, "Missing read-only GitHub token");
  /** @param {string} path @returns {Promise<unknown>} */
  async function api(path) {
    const response = await read(path);
    requireRead(response);
    return /** @type {unknown} */ (await response.json());
  }
  /** @param {Response} response @param {boolean} [absentAllowed] */
  function requireRead(response, absentAllowed = false) {
    requireValue(
      response.ok || (absentAllowed && response.status === 404),
      `GitHub read failed (${response.status})`,
    );
  }
  /** @param {string} path */
  function read(path) {
    return request(`https://api.github.com/repos/${repository}/${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    });
  }
  /** @type {Map<string, boolean>} */
  const publishing = new Map();
  /**
   * The read-only Actions token sees hidden organization membership as CONTRIBUTOR, so
   * `author_association` cannot select publishers. Current repository permission decides; an
   * unknown or deleted account answers 404 and publishes nothing.
   * @param {string} login
   */
  async function canPublish(login) {
    const known = publishing.get(login);
    if (known !== undefined) return known;
    const response = await read(
      `collaborators/${encodeURIComponent(login)}/permission`,
    );
    requireRead(response, true);
    const permitted =
      response.ok &&
      ["admin", "maintain", "write"].includes(
        stringField(object(await response.json()), "permission"),
      );
    publishing.set(login, permitted);
    return permitted;
  }
  /** @param {string} path */
  async function pages(path) {
    /** @type {unknown[]} */
    const values = [];
    for (let page = 1; page <= 100; page++) {
      const result = await api(`${path}?per_page=100&page=${page}`);
      const items = array(result);
      values.push(...items);
      if (items.length < 100) return values;
    }
    throw new Error("GitHub pagination incomplete");
  }
  /** @param {number} number */
  async function readPr(number) {
    const pr = object(await api(`pulls/${number}`));
    const base = object(pr["base"]);
    const repo = object(base["repo"]);
    return {
      number: numberField(pr, "number"),
      state: stringField(pr, "state"),
      body: pr["body"] === null ? "" : stringField(pr, "body", true),
      base: {
        sha: stringField(base, "sha"),
        ref: stringField(base, "ref"),
        repo: { full_name: stringField(repo, "full_name") },
      },
      head: { sha: stringField(object(pr["head"]), "sha") },
    };
  }
  requireValue(
    ["pull_request", "merge_group"].includes(eventName),
    "Review verifier requires PR or merge queue event",
  );
  const eventObject = object(event);
  const eventPr = object(eventObject["pull_request"] ?? {});
  const eventGroup = object(eventObject["merge_group"] ?? {});
  const base =
    eventName === "pull_request"
      ? stringField(object(eventPr["base"]), "sha")
      : stringField(eventGroup, "base_sha");
  requireValue(sha.test(base), "Missing trusted base");
  requireValue(
    git("rev-parse", "HEAD") === candidate && ancestor(base, candidate),
    "Candidate checkout/source mismatch",
  );
  /** @type {Map<number, Awaited<ReturnType<typeof readPr>>>} */
  const prs = new Map();
  /** Squash queue commits proven equal to a reviewed PR head applied to their parent. */
  /** @type {Map<string, number>} */
  const squashes = new Map();
  if (eventName === "pull_request") {
    requireValue(
      Number.isSafeInteger(numberField(eventObject, "number")),
      "Missing PR identity",
    );
    prs.set(
      numberField(eventObject, "number"),
      await readPr(numberField(eventObject, "number")),
    );
  } else {
    requireValue(eventGroup["head_sha"] === candidate, "Queue source mismatch");
    // Query every source commit and every page. Matching a comment on an unrelated
    // PR is insufficient: its current head must cover this candidate's ancestry.
    const commits = git("rev-list", "--no-merges", `${base}..${candidate}`)
      .split("\n")
      .filter(Boolean);
    requireValue(commits.length > 0, "Empty merge queue");
    for (const commit of commits) {
      for (const rawAssociated of await pages(`commits/${commit}/pulls`)) {
        const associated = object(rawAssociated);
        if (
          associated["state"] !== "open" ||
          prs.has(numberField(associated, "number"))
        )
          continue;
        const pr = await readPr(numberField(associated, "number"));
        if (sha.test(pr["head"]?.sha) && ancestor(pr["head"].sha, candidate))
          prs.set(pr["number"], pr);
      }
      // A squash queue commit is new and GitHub associates no PR with it. Its subject only
      // names a candidate PR; the identical tree proves the commit is that reviewed head.
      const named = /\(#(\d+)\)$/u.exec(
        git("log", "-1", "--format=%s", commit),
      );
      if (named?.[1] === undefined) continue;
      const pr = await readPr(Number(named[1]));
      if (pr.state === "open" && squashOf(commit, pr.head.sha)) {
        prs.set(pr.number, pr);
        squashes.set(commit, pr.number);
      }
    }
  }
  requireValue(prs.size > 0, "No current PR covers candidate");
  const sources = [];
  for (const [number, pr] of prs) {
    requireValue(
      pr["number"] === number &&
        pr["state"] === "open" &&
        pr["base"]?.repo.full_name === repository &&
        pr["base"].ref === "main" &&
        pr["base"].sha === base &&
        sha.test(pr["head"]?.sha) &&
        (ancestor(pr["head"].sha, candidate) ||
          [...squashes.values()].includes(number)),
      "Stale, unrelated or incomplete PR source",
    );
    if (eventName === "pull_request")
      requireValue(
        pr["head"].sha === stringField(object(eventPr["head"]), "sha") &&
          pr["base"].sha === stringField(object(eventPr["base"]), "sha"),
        "PR changed since event",
      );
    const comparisonBase = git("merge-base", base, pr["head"].sha);
    const comments = await pages(`issues/${number}/comments`);
    const receipts = [];
    for (const rawComment of comments) {
      const comment = object(rawComment);
      if (
        typeof comment["body"] !== "string" ||
        !comment["body"].includes(marker)
      )
        continue;
      // A comment without an account publishes nothing.
      if (!isObject(comment["user"])) continue;
      const publisher = stringField(comment["user"], "login");
      // Outsiders and revoked publishers can neither supply nor block a receipt.
      if (!(await canPublish(publisher))) continue;
      requireValue(
        comment["body"].startsWith(`${marker}\n`),
        "Malformed review receipt marker",
      );
      let rawReceipt;
      try {
        rawReceipt = /** @type {unknown} */ (
          JSON.parse(comment["body"].slice(marker.length))
        );
      } catch {
        throw new Error("Malformed review receipt JSON");
      }
      // Historical receipts are retained. A malformed receipt is never ignored.
      const receipt = validateReceipt(rawReceipt);
      requireValue(
        receipt.repository === repository && receipt.pullRequest === number,
        "Receipt belongs to another PR",
      );
      if (
        receipt.baseSha !== comparisonBase ||
        receipt.headSha !== pr["head"].sha
      )
        continue;
      const task = await api(`issues/${receipt.task["split"]("/").at(-1)}`);
      requireValue(
        taskDigest(task) === receipt.taskSha256,
        "Task changed since review",
      );
      requireValue(
        pr["body"]?.includes(receipt.task),
        "Receipt task absent from current PR assignment",
      );
      receipts.push({
        commentId: numberField(comment, "id"),
        publisher,
        task: receipt.task,
        taskSha256: receipt.taskSha256,
        receiptSha256: createHash("sha256")
          .update(comment["body"])
          .digest("hex"),
      });
    }
    requireValue(
      receipts.length === 1,
      "Missing or duplicate current review receipt",
    );
    const current = receipts[0];
    requireValue(current, "Missing current receipt");
    sources.push({
      pullRequest: number,
      baseSha: comparisonBase,
      headSha: pr["head"].sha,
      ...current,
    });
  }
  // The queue/PR checkout is usually synthetic. Only deterministic, conflict-free
  // merges of reviewed sources may add commits outside the reviewed PR histories.
  for (const line of git("rev-list", "--parents", `${base}..${candidate}`)
    .split("\n")
    .filter(Boolean)) {
    const [commit, ...parents] = line.split(" ");
    requireValue(commit, "Missing commit");
    if (sources.some((source) => ancestor(commit, source.headSha))) continue;
    const squashed = squashes.get(commit);
    if (sources.some((source) => source.pullRequest === squashed)) continue;
    requireValue(parents.length === 2, "Unreviewed candidate commit");
    const [first, second] = parents;
    requireValue(first && second, "Missing synthetic parents");
    const mergedTree = git("merge-tree", "--write-tree", first, second);
    requireValue(
      sha.test(mergedTree) &&
        mergedTree === git("rev-parse", `${commit}^{tree}`),
      "Synthetic merge differs from reviewed inputs",
    );
  }
  // Close read races: a new head/base must invalidate this run. GitHub's
  // required checks/queue still bind the run to its immutable candidate SHA.
  for (const source of sources) {
    const fresh = await readPr(source.pullRequest);
    requireValue(
      fresh.state === "open" &&
        fresh.head.sha === source.headSha &&
        fresh.base["sha"] === base &&
        fresh.body?.includes(source.task),
      "PR changed during verification",
    );
    requireValue(
      taskDigest(await api(`issues/${source.task["split"]("/").at(-1)}`)) ===
        source.taskSha256,
      "Task changed during verification",
    );
    const comment = object(await api(`issues/comments/${source.commentId}`));
    requireValue(
      createHash("sha256")
        .update(stringField(comment, "body"))
        .digest("hex") === source.receiptSha256 &&
        stringField(object(comment["user"]), "login") === source.publisher,
      "Receipt changed during verification",
    );
  }
  return { status: "verified", candidate, targetBaseSha: base, sources };
}
/** @param {string} name */
function env(name) {
  const value = process.env[name];
  requireValue(value, `Missing environment: ${name}`);
  return value;
}
async function main() {
  if (process.argv[2] === "task-digest") {
    console.log(taskDigest(JSON.parse(readFileSync(0, "utf8"))));
    return;
  }
  if (process.argv[2] === "render") {
    const receipt = validateReceipt(JSON.parse(readFileSync(0, "utf8")));
    console.log(`${marker}\n${JSON.stringify(receipt, null, 2)}`);
    return;
  }
  requireValue(
    process.argv[2] === "verify",
    "Usage: review-evidence.mjs render < receipt.json | verify",
  );
  output(
    await verify({
      event: /** @type {unknown} */ (
        JSON.parse(readFileSync(env("GITHUB_EVENT_PATH"), "utf8"))
      ),
      repository: env("GITHUB_REPOSITORY"),
      eventName: env("GITHUB_EVENT_NAME"),
      candidate: env("REVIEW_CANDIDATE_SHA"),
      token: env("GH_TOKEN"),
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
