import { describe, expect, it } from "vitest";

import {
  evaluatePass,
  passCellCheck,
  passCellParts,
  renderPassMarkdown,
  type PassCell,
} from "../production/pass-cells";
import {
  guideBDeferred,
  identityEmail,
  passCells,
  videoDeferred,
} from "../production/pass-config";
import { redactPassText } from "../production/pass-redaction";

const readsGuideA: PassCell = {
  id: "learner-guide-a/read-guide-a/body@browser",
  expected: "allowed",
};
const deniedGuideB: PassCell = {
  id: "learner-guide-a/read-guide-b/body@browser",
  expected: "denied",
  deferred: guideBDeferred,
};
const deployedSha = "a".repeat(40);

describe("production access pass verdict", () => {
  it("is green when every live cell was observed as expected", () => {
    const report = evaluatePass({
      cells: [readsGuideA],
      observations: [
        { cellId: readsGuideA.id, observed: "allowed", note: "HTTP 302" },
      ],
      deployedSha,
    });

    expect(report.verdict).toBe("green");
    expect(report.cells).toEqual([
      {
        id: readsGuideA.id,
        identity: "learner-guide-a",
        transport: "browser",
        check: "Guide A: закрытое тело урока в HTML и данных RSC страницы",
        level: "production",
        deployedSha,
        expected: "allowed",
        observed: "allowed",
        status: "passed",
        note: "HTTP 302",
      },
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
      reason: guideBDeferred,
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

  it("names why a live cell was not checked", () => {
    const report = evaluatePass({
      cells: [readsGuideA],
      observations: [],
      problems: [
        {
          cellId: readsGuideA.id,
          problem: "Protected body snippet is missing",
        },
      ],
      deployedSha,
    });

    expect(report.verdict).toBe("red");
    expect(report.cells[0]).toMatchObject({
      status: "not_checked",
      reason: "Protected body snippet is missing",
    });
    expect(renderPassMarkdown(report)).toContain(
      "| не проверено: Protected body snippet is missing |",
    );
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

  it("turns red after deploy when the deployed SHA is missing", () => {
    const observations = [
      { cellId: readsGuideA.id, observed: "allowed" as const },
    ];
    const afterDeploy = evaluatePass({
      cells: [readsGuideA],
      observations,
      deployedSha: null,
      deployedShaRequired: true,
    });
    const manual = evaluatePass({
      cells: [readsGuideA],
      observations,
      deployedSha: null,
    });

    expect(afterDeploy.verdict).toBe("red");
    expect(renderPassMarkdown(afterDeploy)).toContain(
      "Deployed SHA: не передан, а после deploy обязателен",
    );
    expect(manual.verdict).toBe("green");
    expect(renderPassMarkdown(manual)).toContain("Deployed SHA: не передан\n");
  });
});

describe("production access pass configuration", () => {
  it("defers only Guide B and video cells, each with its owner decision", () => {
    const cells: readonly PassCell[] = passCells;
    const reasons = cells.map((cell) => {
      const { action, state, surface } = passCellParts(cell.id);
      if (
        action === "read-guide-b" ||
        (state === "learner-guide-b" && action !== "read-guide-a")
      )
        return [cell.deferred, guideBDeferred];
      if (surface === "video") return [cell.deferred, videoDeferred];
      return [cell.deferred, undefined];
    });

    for (const [actual, expected] of reasons) expect(actual).toBe(expected);
    expect(cells.filter((cell) => cell.deferred === undefined).length).toBe(29);
  });

  it("reads every Guide surface in the browser and body and practice through learner MCP too", () => {
    const ids = new Set<string>(passCells.map(({ id }) => id));
    const rows = new Set(
      passCells
        .map(({ id }) => id.split("@")[0] ?? "")
        .filter((row) => row.includes("/read-guide-")),
    );

    for (const row of rows) {
      expect(ids, row).toContain(`${row}@browser`);
      if (row.endsWith("/body") || row.endsWith("/practice"))
        expect(ids, row).toContain(`${row}@learner-mcp`);
    }
  });

  it("names every cell after a matrix row and a transport, once", () => {
    const ids = passCells.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(passCellCheck(id)).not.toBe("");
    expect(() => passCellParts("teacher/read-guide-a/body@browser")).toThrow(
      "Malformed",
    );
    expect(() => passCellParts("anonymous/read-guide-a/body@telegram")).toThrow(
      "Malformed",
    );
  });
});

describe("production access pass report", () => {
  it("renders the level of every cell, every status and the blocked requests", () => {
    const markdown = renderPassMarkdown(
      evaluatePass({
        cells: [readsGuideA, deniedGuideB],
        observations: [],
        deployedSha,
        blockedRequests: [
          {
            method: "POST",
            target: "https://inside.sachkov.dev/api/reading-progress/states",
            reason: "POST /api/reading-progress/states is not a read",
          },
        ],
      }),
    );

    expect(markdown).toContain(`Deployed SHA: \`${deployedSha}\``);
    expect(markdown).toContain("Итог: **красный**");
    expect(markdown).toContain("| production | не проверено |");
    expect(markdown).toContain(`| production | ${guideBDeferred} |`);
    expect(markdown).toContain(
      "- `POST https://inside.sachkov.dev/api/reading-progress/states`",
    );
  });

  it("turns red when the browser sent a redirect step outside the allowlist", () => {
    const report = evaluatePass({
      cells: [readsGuideA],
      observations: [{ cellId: readsGuideA.id, observed: "allowed" }],
      deployedSha,
      blockedRequests: [
        {
          method: "GET",
          target: "https://inside.sachkov.dev/communications/visit",
          reason: "redirect step: /communications/visit records a visit",
          sent: true,
        },
      ],
    });

    expect(report.verdict).toBe("red");
    expect(renderPassMarkdown(report)).toContain("— **отправлен**");
  });

  it("removes cookies, tokens and email from the report text", () => {
    const mailbox = "owner.name@example.test";
    const secret = "m2m-application-secret-value";
    const text = [
      `email ${mailbox} and alias owner.name+inside-access-expired@example.test`,
      `encoded ${encodeURIComponent("owner.name+inside-access-expired@example.test")}`,
      `jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl`,
      "authorization: Bearer abc.def-ghi",
      "pat pat_K3x9abcDEF",
      "url https://auth.sachkov.dev/oidc/auth?one_time_token=ott-123&login_hint=x&state=s1",
      "set-cookie: logto_session=abc; Path=/",
      `secret ${secret}`,
    ].join("\n");

    const redacted = redactPassText(text, [mailbox, secret]);

    for (const leaked of [
      "owner.name",
      "example.test",
      "eyJ",
      "abc.def-ghi",
      "pat_K3x9",
      "ott-123",
      "logto_session",
      secret,
      "%40",
    ])
      expect(redacted).not.toContain(leaked);
    expect(redacted).toContain("one_time_token=[скрыто]");
  });

  it("keeps the report JSON valid after redaction", () => {
    const report = evaluatePass({
      cells: [readsGuideA],
      observations: [
        {
          cellId: readsGuideA.id,
          observed: "allowed",
          note: 'cookie: logto_session=abc" user@example.test token=x"',
        },
      ],
      deployedSha,
    });

    const json = redactPassText(JSON.stringify(report, null, 2), []);

    expect(() => JSON.parse(json) as unknown).not.toThrow();
    expect(json).not.toContain("logto_session");
    expect(json).not.toContain("user@example.test");
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
