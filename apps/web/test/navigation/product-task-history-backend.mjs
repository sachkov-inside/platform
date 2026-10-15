// @ts-check
import { z } from "zod";
/** @type {unknown} */
const fixtureModule = await import(
  new URL("../../src/storybook/product-task.fixtures.ts", import.meta.url).href
);

const { openProductTask, closedProductTask } = z
  .object({
    openProductTask: z
      .object({
        task: z
          .object({
            definition: z.object({ criteria: z.array(z.unknown()) }).loose(),
          })
          .loose(),
      })
      .loose(),
    closedProductTask: z.unknown(),
  })
  .parse(fixtureModule);

let unavailable = false;
let held = false;
/** @type {Promise<void> | undefined} */
let gate;
/** @type {(() => void) | undefined} */
let release;
const controlSchema = z
  .object({ unavailable: z.boolean(), hold: z.boolean().optional() })
  .strict();
const code = "aie-ch1-onboarding";
const slug = "ai-engineering";

/** A real production RSC transport fixture; permission/ownership enforcement has PostgreSQL tests.
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 * @returns {Promise<{status: number, value: unknown} | null>}
 */
export async function productTaskHistoryRoute(request, url, readBody) {
  if (url.pathname === "/__own-history") {
    if (request.method === "POST") {
      const input = controlSchema.parse(JSON.parse(await readBody(request)));
      unavailable = input.unavailable;
      release?.();
      held = false;
      gate =
        input.hold === true
          ? new Promise((resolve) => {
              release = resolve;
            })
          : undefined;
    }
    return { status: 200, value: { unavailable, held } };
  }
  if (url.pathname === `/library/products/${slug}/tasks/${code}`) {
    return {
      status: 200,
      value:
        request.headers.authorization === undefined
          ? { access: "closed", task: closedProductTask }
          : openProductTask,
    };
  }
  if (url.pathname !== `/accounts/current/product-tasks/${code}/submissions`)
    return null;
  if (request.headers.authorization === undefined)
    return { status: 401, value: { code: "invalid_proof" } };
  const after = url.searchParams.get("after");
  if (after !== null && after !== "older-history")
    return { status: 400, value: { code: "invalid_request_shape" } };
  if (after !== null && gate !== undefined) {
    held = true;
    await gate;
    held = false;
  }
  if (after !== null && unavailable)
    return { status: 503, value: { code: "dependency_unavailable" } };
  const attempts = Array.from({ length: 51 }, (_, index) => ({
    submissionId: `70000000-0000-4000-8000-${String(51 - index).padStart(12, "0")}`,
    taskVersion: 2,
    source: "form",
    submittedAt:
      index === 0 ? "2026-10-02T00:00:00.000Z" : "2026-10-01T00:00:00.000Z",
    note: `Saved attempt ${String(51 - index)}`,
    reportText: "Saved participant report",
    repositoryUrl: null,
    authorFeedback:
      index === 50
        ? {
            comment: "Oldest feedback remains reachable",
            reviewedAt: "2026-10-02T00:00:00.000Z",
          }
        : null,
  }));
  return {
    status: 200,
    value: {
      code,
      currentVersion: 2,
      latestSubmittedAt: "2026-10-02T00:00:00.000Z",
      versions: [
        { version: 2, criteria: openProductTask.task.definition.criteria },
      ],
      submissions: after === null ? attempts.slice(0, 50) : attempts.slice(50),
      nextCursor: after === null ? "older-history" : null,
    },
  };
}
