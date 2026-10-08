// @ts-check
import { z } from "zod";

const eventSchema = z.object({
  type: z.string(),
  data: z
    .object({
      name: z.string().optional(),
      file: z.string().optional(),
      line: z.number().optional(),
      column: z.number().optional(),
      nesting: z.number().optional(),
      skip: z.union([z.boolean(), z.string()]).optional(),
      todo: z.union([z.boolean(), z.string()]).optional(),
      details: z.object({ type: z.string().optional() }).optional(),
    })
    .passthrough(),
});

/** Node's test reporter emits the same small JSON boundary as the Vitest adapter.
 * @param {AsyncIterable<unknown>} source
 */
export default async function* reporter(source) {
  /** @type {Map<string, {name: string, assertionResults: {fullName: string, status: string}[]}>} */
  const files = new Map();
  /** @type {Map<string, string>} */
  const names = new Map();
  /** @type {string[]} */
  const parents = [];
  for await (const input of source) {
    const parsed = eventSchema.safeParse(input);
    if (!parsed.success) continue;
    const { type, data } = parsed.data;
    const key = `${data.file}:${data.line}:${data.column}:${data.name}`;
    if (type === "test:enqueue" && data.name !== undefined) {
      const nesting = data.nesting ?? 0;
      parents.length = nesting;
      names.set(key, [...parents, data.name].join(" > "));
      parents[nesting] = data.name;
    }
    if (
      !["test:pass", "test:fail"].includes(type) ||
      data.details?.type === "suite" ||
      data.file === undefined ||
      data.name === undefined
    )
      continue;
    const file = files.get(data.file) ?? {
      name: data.file,
      assertionResults: [],
    };
    const skipped =
      (data.skip !== undefined && data.skip !== false) ||
      (data.todo !== undefined && data.todo !== false);
    file.assertionResults.push({
      fullName: names.get(key) ?? data.name,
      status: skipped ? "skipped" : type === "test:pass" ? "passed" : "failed",
    });
    files.set(data.file, file);
  }
  yield JSON.stringify({ testResults: [...files.values()] });
}
