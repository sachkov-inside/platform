// @ts-check
import { z } from "zod";
import { learningHttpReader } from "../../../../scenarios/learning-http.mjs";
import { lessonInteractions } from "../../../../scenarios/lesson-interactions.mjs";

const { materialId, exercise, attempt } = lessonInteractions;
const slug = "navigation-exercise-owner";
const accounts = new Map([
  ["Bearer exercise-owner-first", "dddddddd-0000-4000-8000-000000000001"],
  ["Bearer exercise-owner-second", "dddddddd-0000-4000-8000-000000000002"],
]);
/** @param {string} value */
const paragraph = (value) => ({
  kind: "paragraph",
  content: [{ kind: "text", text: value, marks: [] }],
});

/** @param {import("node:http").IncomingMessage} request @param {URL} url @param {(r:import("node:http").IncomingMessage)=>Promise<string>} readBody */
export async function exerciseOwnerRoute(request, url, readBody) {
  if (request.method === "GET" && url.pathname === "/materials/" + slug) {
    const reader = z
      .looseObject({
        kind: z.literal("available"),
        projection: z.record(z.string(), z.unknown()),
      })
      .parse(learningHttpReader("synthetic-intro", "learner"));
    return {
      status: 200,
      value: {
        ...reader,
        projection: {
          ...reader.projection,
          materialId,
          slug,
          productMemberships: [],
        },
        body: {
          schemaVersion: 1,
          blocks: [
            {
              kind: "quiz",
              id: exercise.id,
              reveal: "none",
              question: [paragraph(exercise.question)],
              selectionMode: "single",
              options: Object.entries(exercise.options).map(([id, label]) => ({
                id,
                content: [paragraph(label)],
                correct: id === "prompt",
                ...(id === "prompt"
                  ? {}
                  : {
                      explanation: [
                        paragraph("Эта проверка относится к промпту."),
                      ],
                    }),
              })),
            },
          ],
        },
      },
    };
  }
  const account = accounts.get(request.headers.authorization ?? "");
  if (account === undefined) return null;
  if (request.method === "GET" && url.pathname === "/accounts/current")
    return { status: 200, value: { account: { accountId: account } } };
  const attempts = "/exercise-attempts/materials/" + materialId;
  if (request.method === "GET" && url.pathname === attempts)
    return { status: 200, value: { items: [] } };
  if (
    request.method === "POST" &&
    url.pathname === attempts + "/exercises/" + exercise.id
  ) {
    const body = await readBody(request);
    if (
      request.headers.authorization !== "Bearer exercise-owner-first" ||
      !z
        .strictObject({
          answer: z.strictObject({
            kind: z.literal("options"),
            optionIds: z.tuple([z.literal("prompt")]),
          }),
        })
        .safeParse(JSON.parse(body)).success
    )
      return { status: 403, value: { code: "forbidden" } };
    return { status: 200, value: attempt };
  }
  return null;
}
