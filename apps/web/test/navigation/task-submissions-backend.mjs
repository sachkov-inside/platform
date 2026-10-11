// @ts-check
import { readFileSync } from "node:fs";
import { z } from "zod";

const schema = z
  .object({
    products: z.array(z.unknown()),
    versions: z.array(z.unknown()),
    history: z.array(z.unknown()),
    nextCursor: z.string().nullable(),
    submissions: z.array(
      z
        .object({
          submissionId: z.string(),
          task: z
            .object({
              productId: z.string(),
              chapterId: z.string(),
              code: z.string(),
            })
            .loose(),
        })
        .loose(),
    ),
  })
  .strict();
const fixture = schema.parse(
  JSON.parse(
    readFileSync(
      new URL("../fixtures/task-submissions.json", import.meta.url),
      "utf8",
    ),
  ),
);
const feedbackSchema = z
  .object({ comment: z.string(), reviewed: z.boolean() })
  .strict();
/** @type {Map<string, {comment: string | null, reviewedAt: string | null, updatedAt: string} | null>} */
const feedbacks = new Map();
let writes = 0;
/** @type {Promise<void> | undefined} */
let gate;
/** @type {(() => void) | undefined} */
let release;

/** An isolated HTTP fixture for the production submissions route, not a permission test. Tokens
 * select authored outcomes; real permission/scope/ownership checks live in backend integration.
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 * @returns {Promise<{status: number, value: unknown} | null>}
 */
export async function taskSubmissionsRoute(request, url, readBody) {
  if (url.pathname === "/__submissions/reset") {
    release?.();
    gate = undefined;
    feedbacks.clear();
    writes = 0;
    return { status: 200, value: { reset: true } };
  }
  if (url.pathname === "/__submissions/hold") {
    const { hold } = z
      .object({ hold: z.boolean() })
      .strict()
      .parse(JSON.parse(await readBody(request)));
    release?.();
    gate = hold
      ? new Promise((resolveGate) => {
          release = resolveGate;
        })
      : undefined;
    return { status: 200, value: { hold } };
  }
  const token = request.headers.authorization;
  if (!url.pathname.startsWith("/authoring/product-tasks/submissions"))
    return null;
  await gate;
  if (token === "Bearer submissions-forbidden")
    return { status: 403, value: { code: "forbidden" } };
  if (token === "Bearer submissions-expired")
    return { status: 401, value: { code: "invalid_proof" } };
  if (token === "Bearer submissions-unavailable")
    return { status: 503, value: { code: "dependency_unavailable" } };
  if (token === undefined)
    return { status: 401, value: { code: "invalid_proof" } };
  if (request.method === "PUT") {
    const id = url.pathname.split("/").at(-2);
    if (
      id === undefined ||
      !fixture.submissions.some((row) => row.submissionId === id)
    )
      return { status: 404, value: { code: "submission_not_found" } };
    const input = feedbackSchema.parse(JSON.parse(await readBody(request)));
    writes += 1;
    const now = new Date(
      Date.parse("2026-10-11T09:00:00.000Z") + writes * 60_000,
    ).toISOString();
    const authorFeedback =
      input.comment.trim() === "" && !input.reviewed
        ? null
        : {
            comment: input.comment.trim() === "" ? null : input.comment.trim(),
            reviewedAt: input.reviewed ? now : null,
            updatedAt: now,
          };
    feedbacks.set(id, authorFeedback);
    return { status: 200, value: { authorFeedback } };
  }
  const cursor = url.searchParams.get("cursor");
  if (cursor !== null && cursor !== "page-2")
    return { status: 400, value: { code: "invalid_request_shape" } };
  let rows = fixture.submissions.filter((row) =>
    [
      ["productId", row.task.productId],
      ["chapterId", row.task.chapterId],
      ["taskCode", row.task.code],
    ].every(
      ([key, value]) =>
        key !== undefined &&
        (!url.searchParams.has(key) || url.searchParams.get(key) === value),
    ),
  );
  if (token === "Bearer submissions-empty") rows = [];
  const chosen = url.searchParams.get("submissionId");
  const selected = rows.find((row) => row.submissionId === chosen);
  const history =
    selected === undefined
      ? []
      : rows
          .filter(
            (row) =>
              row.task.code === selected.task.code &&
              row["person"] !== undefined &&
              JSON.stringify(row["person"]) ===
                JSON.stringify(selected["person"]) &&
              row["selfCheck"] != null,
          )
          .map((row) => ({
            submissionId: row.submissionId,
            submittedAt: row["submittedAt"],
            taskVersion: row["taskVersion"],
            summary: null,
            selfCheck: row["selfCheck"],
          }));
  const page =
    chosen !== null
      ? rows.filter((row) => row.submissionId === chosen)
      : cursor === null
        ? rows.slice(0, 2)
        : rows.slice(2);
  return {
    status: 200,
    value: {
      ...fixture,
      history,
      submissions: page.map((row) => ({
        ...row,
        authorFeedback: feedbacks.has(row.submissionId)
          ? feedbacks.get(row.submissionId)
          : row["authorFeedback"],
      })),
      nextCursor:
        chosen === null && cursor === null && rows.length > 2 ? "page-2" : null,
    },
  };
}
