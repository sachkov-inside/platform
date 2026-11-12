import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { aiModelsWidgetFitCommand } from "../../scripts/ai-models-widget/fit.js";
import {
  syntheticAiModelsReference,
  type SyntheticAiModelsReference,
} from "../support/synthetic-ai-models-reference.js";
import { wideText } from "./widget-harness.js";

// The command the owner runs on the real Справочник before the import: it draws every screen of
// the file in the built widget. Every text here is synthetic.

let directory: string;
let files = 0;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "ai-models-fit-"));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** Runs the command on `content` written to a file and collects what it writes. */
async function fit(content: string | undefined) {
  const report: string[] = [];
  const remarks: string[] = [];
  let file: string | undefined;
  if (content !== undefined) {
    files += 1;
    file = path.join(directory, `${String(files)}.json`);
    await writeFile(file, content);
  }
  const exitCode = await aiModelsWidgetFitCommand(file, {
    report: (line) => report.push(line),
    remark: (line) => remarks.push(line),
  });
  return { exitCode, report, remarks };
}
const json = (file: SyntheticAiModelsReference) => JSON.stringify(file);

describe("ИИ-модели widget fit of a Справочник file", () => {
  it("measures every screen of the file at 320 and 390 px and reports numbers only", async () => {
    const { exitCode, report, remarks } = await fit(
      json(syntheticAiModelsReference()),
    );

    expect(exitCode).toBe(0);
    // Six list pages, both tabs of nine cards and «О данных» at each width.
    expect(report).toHaveLength(2 * (6 + 2 * 9 + 1));
    const lines = report.map((line) => JSON.parse(line) as unknown);
    expect(lines[0]).toMatchObject({
      request: "3lp0",
      widthPx: 320,
      fits: true,
      overflow: false,
    });
    expect(lines.at(-1)).toMatchObject({ request: "3a", widthPx: 390 });
    expect(report.join("\n")).not.toMatch(/[а-яё]/i);
    expect(remarks).toEqual([
      expect.stringMatching(
        /^320 px: 25 screens, the tallest \d+ px, the smallest text \d+ px, \d+ with summaries cut\.$/,
      ),
      expect.stringMatching(/^390 px: 25 screens, /),
      "0 screens do not fit 560 px in text of 11 px or more without overflow.",
    ]);
  });

  it("names a screen that does not fit and fails", async () => {
    // Twelve plans with estimates in four services: taller than 560 px at 320 px.
    const file = syntheticAiModelsReference();
    const services = ["atlas", "boreal", "gate", "cirrus"];
    file.plans = Array.from({ length: 12 }, (_, index) => ({
      code: `p${String(index)}`,
      service: services[index % 4] ?? "atlas",
      name: wideText(3, index),
      usdPerMonth: 10,
      priceFrom: false,
    }));
    for (const model of file.models) model.subscriptions = [];
    const [first] = file.models;
    if (!first) throw new Error("The synthetic file has models");
    first.subscriptions = file.plans.map(({ code }) => ({
      plan: code,
      estimate: { basis: "measured", apiUsdPerMonth: 9000, accounts: 5 },
      note: wideText(3),
    }));
    const { exitCode, report, remarks } = await fit(json(file));

    expect(exitCode).toBe(1);
    expect(
      report
        .map((line) =>
          z
            .object({ request: z.string(), fits: z.boolean() })
            .parse(JSON.parse(line)),
        )
        .filter(({ fits }) => !fits)
        .map(({ request }) => request),
    ).toContain(`3s${first.code}`);
    expect(remarks.at(-1)).toMatch(/^[1-9]\d* screens do not fit 560 px/);
  });

  it("reports the import's errors for a rejected file without its texts", async () => {
    const file = syntheticAiModelsReference();
    Object.assign(file.models[0] ?? {}, { arenaRank: 0 });

    const { exitCode, report, remarks } = await fit(json(file));

    expect(exitCode).toBe(2);
    expect(report.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({ model: "atlas-pro", field: "arenaRank" }),
    ]);
    expect(remarks).toEqual([
      "The Справочник file is rejected by the import check: 1 errors.",
    ]);
  });

  it.each([
    ["no file", undefined, "Usage: "],
    ["a file that is not JSON", "{ «текст»", "cannot be read as JSON"],
  ])("refuses %s", async (_name, content, remark) => {
    const { exitCode, report, remarks } = await fit(content);

    expect(exitCode).toBe(2);
    expect(report).toEqual([]);
    expect(remarks.join("\n")).toContain(remark);
    expect(remarks.join("\n")).not.toContain("текст");
  });
});
