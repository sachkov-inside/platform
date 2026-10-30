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
    const response = await request(
      `https://api.github.com/repos/${repository}/${path}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    requireValue(response.ok, `GitHub read failed (${response.status})`);
    return /** @type {unknown} */ (await response.json());
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
  // This is a fixed read-only operation. Candidate data is only supplied as
  // validated variables; it cannot select a GraphQL operation or endpoint.
  const queueQuery = `query ReviewQueue($owner:String!,$name:String!,$after:String) {
    repository(owner:$owner,name:$name) {
      mergeQueue(branch:"main") {
        entries(first:100,after:$after) {
          nodes { id baseCommit { oid } headCommit { oid }
            pullRequest { number headRefOid state } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }`;
  async function readQueue() {
    const [owner, name] = repository.split("/");
    /** @type {string | null} */
    let after = null;
    /** @type {Array<{id:string, baseSha:string | null, headSha:string | null, number:number, sourceHead:string, state:string}>} */
    const entries = [];
    const cursors = new Set();
    const ids = new Set();
    for (let page = 1; page <= 100; page++) {
      const response = await request("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          query: queueQuery,
          variables: { owner, name, after },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      requireValue(
        response.ok,
        `GitHub queue read failed (${response.status})`,
      );
      const result = object(await response.json());
      requireValue(!result["errors"], "GitHub queue query failed");
      const repo = object(object(result["data"])["repository"]);
      const connection = object(object(repo["mergeQueue"])["entries"]);
      const nodes = array(connection["nodes"]);
      requireValue(nodes.length <= 100, "Invalid queue page size");
      for (const raw of nodes) {
        const entry = object(raw);
        const pr = object(entry["pullRequest"]);
        const id = stringField(entry, "id");
        requireValue(!ids.has(id), "Duplicate queue entry");
        ids.add(id);
        /** @param {unknown} value */
        function commitOid(value) {
          if (value === null) return null;
          const oid = stringField(object(value), "oid");
          requireValue(sha.test(oid), "Invalid queue commit");
          return oid;
        }
        const sourceHead = stringField(pr, "headRefOid");
        requireValue(sha.test(sourceHead), "Invalid queued PR head");
        entries.push({
          id,
          baseSha: commitOid(entry["baseCommit"]),
          headSha: commitOid(entry["headCommit"]),
          number: numberField(pr, "number"),
          sourceHead,
          state: stringField(pr, "state"),
        });
      }
      const pageInfo = object(connection["pageInfo"]);
      requireValue(
        typeof pageInfo["hasNextPage"] === "boolean",
        "Missing queue pagination state",
      );
      if (!pageInfo["hasNextPage"]) return entries;
      after = stringField(pageInfo, "endCursor");
      requireValue(!cursors.has(after), "Repeated queue pagination cursor");
      cursors.add(after);
    }
    throw new Error("GitHub queue pagination incomplete");
  }
  /** @param {number} number */
  async function readPr(number) {
    const pr = object(await api(`pulls/${number}`));
    const base = object(pr["base"]);
    const repo = object(base["repo"]);
    return {
      number: numberField(pr, "number"),
      state: stringField(pr, "state"),
      merged: pr["merged"] === true,
      mergeCommitSha: pr["merge_commit_sha"],
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
  /** @type {Map<string, Set<number>>} */
  const associations = new Map();
  /** @type {Map<number, Awaited<ReturnType<typeof readQueue>>[number]>} */
  const queueBindings = new Map();
  let candidateInQueue = false;
  const candidateCommits = git("rev-list", "--parents", `${base}..${candidate}`)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" "));
  /** @param {string[]} transition @param {string} head */
  function exactSquash(transition, head) {
    const [commit, parent, ...extra] = transition;
    if (!commit || !parent || extra.length || ancestor(commit, head))
      return false;
    try {
      const tree = git("rev-parse", `${commit}^{tree}`);
      return (
        tree !== git("rev-parse", `${parent}^{tree}`) &&
        git("merge-tree", "--write-tree", parent, head) === tree
      );
    } catch {
      return false;
    }
  }
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
    // Associations authenticate the concrete queue commit, never a branch name
    // or a tree alone. A squash source need not be in the candidate ancestry.
    requireValue(candidateCommits.length > 0, "Empty merge queue");
    const queue = await readQueue();
    candidateInQueue = queue.some(
      (entry) => entry.headSha === candidate && entry.state === "OPEN",
    );
    for (const entry of queue) {
      if (
        !candidateCommits.some((transition) => transition[0] === entry.headSha)
      )
        continue;
      requireValue(
        entry.state === "OPEN" &&
          entry.baseSha &&
          entry.headSha &&
          ancestor(entry.baseSha, entry.headSha) &&
          (ancestor(base, entry.baseSha) || ancestor(entry.baseSha, base)),
        "Unrelated queue entry",
      );
      requireValue(
        !queueBindings.has(entry.number),
        "Duplicate queued PR source",
      );
      const pr = await readPr(entry.number);
      requireValue(
        pr.number === entry.number &&
          pr.state === "open" &&
          pr.head.sha === entry.sourceHead,
        "Queue PR changed or mismatched",
      );
      queueBindings.set(entry.number, entry);
      prs.set(entry.number, pr);
      const numbers = associations.get(entry.headSha) ?? new Set();
      numbers.add(entry.number);
      associations.set(entry.headSha, numbers);
    }
    for (const transition of candidateCommits) {
      const commit = transition[0];
      requireValue(commit, "Missing candidate commit");
      if (transition.length !== 2) continue;
      /** @type {Set<number>} */
      const associatedNumbers = associations.get(commit) ?? new Set();
      associations.set(commit, associatedNumbers);
      for (const rawAssociated of await pages(`commits/${commit}/pulls`)) {
        const associated = object(rawAssociated);
        if (!["open", "closed"].includes(String(associated["state"]))) continue;
        const number = numberField(associated, "number");
        if (prs.has(number)) continue;
        const pr = await readPr(number);
        requireValue(pr.number === number, "PR association identity mismatch");
        let introduced = false;
        if (
          pr.state === "closed" &&
          pr.merged &&
          pr.mergeCommitSha === commit
        ) {
          const mainRef = object(await api("git/ref/heads/main"));
          const mainObject = object(mainRef["object"]);
          requireValue(
            mainRef["ref"] === "refs/heads/main" &&
              mainObject["type"] === "commit",
            "Invalid authoritative main ref",
          );
          const main = stringField(mainObject, "sha");
          requireValue(
            sha.test(main) && ancestor(base, main),
            "Unrelated authoritative main",
          );
          introduced = ancestor(commit, main);
        }
        if (
          sha.test(pr.head.sha) &&
          ((pr.state === "open" && ancestor(pr.head.sha, candidate)) ||
            (introduced && exactSquash(transition, pr.head.sha)))
        ) {
          associatedNumbers.add(number);
          prs.set(number, pr);
        }
      }
    }
  }
  requireValue(prs.size > 0, "No current PR covers candidate");
  requireValue(
    [...prs.values()].some((pr) => pr.state === "open"),
    "No open reviewed queue source",
  );
  const sources = [];
  for (const [number, pr] of prs) {
    requireValue(
      pr["number"] === number &&
        (pr.state === "open" ||
          (eventName === "merge_group" &&
            pr.state === "closed" &&
            pr.merged)) &&
        pr["base"]?.repo.full_name === repository &&
        pr["base"].ref === "main" &&
        sha.test(pr.base.sha) &&
        (ancestor(base, pr.base.sha) ||
          (pr.merged && ancestor(pr.base.sha, base))) &&
        sha.test(pr["head"]?.sha) &&
        (eventName === "merge_group" || ancestor(pr["head"].sha, candidate)),
      "Stale, unrelated or incomplete PR source",
    );
    if (eventName === "pull_request")
      requireValue(
        pr["head"].sha === stringField(object(eventPr["head"]), "sha") &&
          pr["base"].sha === stringField(object(eventPr["base"]), "sha"),
        "PR changed since event",
      );
    // Open PR bases follow current main. A merged PR retains its historical
    // provider base snapshot; neither an older event nor moving main can replace
    // that authenticated comparison input. Receipt matching has no fallback.
    const comparisonBase = git("merge-base", pr.base.sha, pr.head.sha);
    const comments = await pages(`issues/${number}/comments`);
    const receipts = [];
    for (const rawComment of comments) {
      const comment = object(rawComment);
      if (
        typeof comment["body"] !== "string" ||
        !comment["body"].includes(marker)
      )
        continue;
      if (
        !["OWNER", "MEMBER", "COLLABORATOR"].includes(
          stringField(comment, "author_association"),
        )
      )
        continue;
      const publisher = stringField(object(comment["user"]), "login");
      const permission = object(
        await api(`collaborators/${encodeURIComponent(publisher)}/permission`),
      );
      requireValue(
        ["admin", "maintain", "write"].includes(
          stringField(permission, "permission"),
        ),
        "Receipt publisher lacks current write permission",
      );
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
  // Every commit outside reviewed histories needs an exact transition proof.
  // Two-parent test merges retain their Git proof; one-parent queue squashes
  // additionally need an authenticated PR association for that very commit.
  const squashedSources = new Set();
  for (const transition of candidateCommits) {
    const [commit, ...parents] = transition;
    requireValue(commit, "Missing commit");
    if (sources.some((source) => ancestor(commit, source.headSha))) continue;
    if (parents.length === 1 && eventName === "merge_group") {
      const matches = sources.filter((source) => {
        const pr = prs.get(source.pullRequest);
        return (
          associations.get(commit)?.has(source.pullRequest) &&
          pr &&
          (pr.state === "open"
            ? candidateInQueue &&
              queueBindings.get(source.pullRequest)?.headSha === commit
            : pr.mergeCommitSha === commit) &&
          exactSquash(transition, source.headSha)
        );
      });
      requireValue(
        matches.length === 1,
        "Missing or ambiguous authenticated squash source",
      );
      const source = matches[0];
      requireValue(
        source && !squashedSources.has(source.pullRequest),
        "Repeated squash source",
      );
      squashedSources.add(source.pullRequest);
      continue;
    }
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
    const original = prs.get(source.pullRequest);
    requireValue(
      original &&
        JSON.stringify(fresh) === JSON.stringify(original) &&
        fresh.head.sha === source.headSha &&
        fresh.body.includes(source.task),
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
  if (queueBindings.size > 0) {
    const freshQueue = await readQueue();
    requireValue(
      freshQueue.some(
        (entry) => entry.headSha === candidate && entry.state === "OPEN",
      ),
      "Candidate left merge queue",
    );
    for (const [number, original] of queueBindings) {
      const fresh = freshQueue.filter((entry) => entry.number === number);
      requireValue(
        fresh.length === 1 &&
          JSON.stringify(fresh[0]) === JSON.stringify(original),
        "Queue entry changed during verification",
      );
    }
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
