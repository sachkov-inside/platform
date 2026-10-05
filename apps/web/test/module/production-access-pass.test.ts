import { describe, expect, it } from "vitest";

import {
  evaluatePass,
  renderPassMarkdown,
  type PassCell,
} from "../production/pass-cells";
import {
  guideBDeferred,
  identityEmail,
  passCells,
} from "../production/pass-config";

const readsGuideA: PassCell = {
  id: "learner-guide-a/browser/guide-a-body",
  identity: "learner-guide-a",
  surface: "browser",
  action: "Читает защищённое тело Guide A",
  expected: "allowed",
};
const deniedGuideB: PassCell = {
  id: "learner-guide-a/browser/guide-b-body",
  identity: "learner-guide-a",
  surface: "browser",
  action: "Не получает закрытых bytes Guide B",
  expected: "denied",
  deferred: "отложено до второго Guide",
};
const deployedSha = "a".repeat(40);

describe("production access pass verdict", () => {
  it("is green when every live cell was observed as expected", () => {
    const report = evaluatePass({
      cells: [readsGuideA],
      observations: [{ cellId: readsGuideA.id, observed: "allowed" }],
      deployedSha,
    });

    expect(report.verdict).toBe("green");
    expect(report.cells).toEqual([
      expect.objectContaining({
        id: readsGuideA.id,
        status: "passed",
        expected: "allowed",
        observed: "allowed",
        level: "production",
        deployedSha,
      }),
    ]);
  });

  it("shows a deferred cell separately and keeps the job green", () => {
    const report = evaluatePass({
      cells: [readsGuideA, deniedGuideB],
      observations: [{ cellId: readsGuideA.id, observed: "allowed" }],
      deployedSha,
    });

    expect(report.verdict).toBe("green");
    expect(report.cells.map((cell) => cell.status)).toEqual([
      "passed",
      "deferred",
    ]);
    expect(report.cells[1]).toMatchObject({
      observed: null,
      reason: "отложено до второго Guide",
    });
  });

  it("turns red on a live cell that was not checked", () => {
    const report = evaluatePass({
      cells: [readsGuideA, deniedGuideB],
      observations: [],
      deployedSha,
    });

    expect(report.verdict).toBe("red");
    expect(report.cells.map((cell) => cell.status)).toEqual([
      "not_checked",
      "deferred",
    ]);
  });

  it("turns red on a mismatch", () => {
    const report = evaluatePass({
      cells: [readsGuideA],
      observations: [{ cellId: readsGuideA.id, observed: "denied" }],
      deployedSha,
    });

    expect(report.verdict).toBe("red");
    expect(report.cells[0]?.status).toBe("failed");
  });

  it("does not let an observation of a deferred cell change its status", () => {
    const report = evaluatePass({
      cells: [deniedGuideB],
      observations: [{ cellId: deniedGuideB.id, observed: "allowed" }],
      deployedSha,
    });

    expect(report.verdict).toBe("green");
    expect(report.cells[0]?.status).toBe("deferred");
  });

  it("refuses an observation for a cell outside the configuration", () => {
    expect(() =>
      evaluatePass({
        cells: [readsGuideA],
        observations: [
          { cellId: readsGuideA.id, observed: "allowed" },
          { cellId: "unknown", observed: "allowed" },
        ],
        deployedSha,
      }),
    ).toThrow("unknown");
  });

  it("marks every Guide B cell of the configuration as deferred", () => {
    const cells: readonly PassCell[] = passCells;
    const guideB = cells.filter(({ id }) => id.endsWith("/guide-b-body"));

    expect(guideB.length).toBeGreaterThan(0);
    expect(guideB.every((cell) => cell.deferred === guideBDeferred)).toBe(true);
    expect(
      cells.filter(
        (cell) =>
          cell.deferred !== undefined && !cell.id.endsWith("/guide-b-body"),
      ),
    ).toEqual([]);
  });

  it("renders every status in the Markdown report", () => {
    const markdown = renderPassMarkdown(
      evaluatePass({
        cells: [readsGuideA, deniedGuideB],
        observations: [],
        deployedSha,
      }),
    );

    expect(markdown).toContain(`Deployed SHA: \`${deployedSha}\``);
    expect(markdown).toContain("Итог: **красный**");
    expect(markdown).toContain("| не проверено |");
    expect(markdown).toContain("| отложено до второго Guide |");
  });
});

describe("test identity email", () => {
  it("is an alias of the configured mailbox", () => {
    expect(identityEmail("owner@example.test", "learner-guide-a")).toBe(
      "owner+inside-access-learner-guide-a@example.test",
    );
  });

  it("rejects a mailbox that is already an alias", () => {
    expect(() =>
      identityEmail("owner+x@example.test", "learner-guide-a"),
    ).toThrow("plain address");
  });
});
