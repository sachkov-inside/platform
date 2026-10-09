import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  evaluatePass,
  passCellCheck,
  passCellParts,
  renderPassMarkdown,
  type PassCell,
} from "../production/pass-cells";
import {
  productionTarget,
  productBDeferred,
  identityEmail,
  passCells,
  videoDeferred,
} from "../production/pass-config";
import { redactPassText } from "../production/pass-redaction";
import { problemLine } from "../production/pass-report";

const readsProductA: PassCell = {
  id: "learner-product-a/read-product-a/body@browser",
  expected: "allowed",
};
const deniedProductB: PassCell = {
  id: "learner-product-a/read-product-b/body@browser",
  expected: "denied",
  deferred: productBDeferred,
};
const deployedSha = "a".repeat(40);

describe("production access pass verdict", () => {
  it("is green when every live cell was observed as expected", () => {
    const report = evaluatePass({
      cells: [readsProductA],
      observations: [
        { cellId: readsProductA.id, observed: "allowed", note: "HTTP 302" },
      ],
      deployedSha,
    });

    expect(report.verdict).toBe("green");
    expect(report.cells).toEqual([
      {
        id: readsProductA.id,
        identity: "learner-product-a",
        transport: "browser",
        check: "Product A: закрытое тело урока в HTML и данных RSC страницы",
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
      cells: [readsProductA, deniedProductB],
      observations: [{ cellId: readsProductA.id, observed: "allowed" }],
      deployedSha,
    });

    expect(report.verdict).toBe("green");
    expect(report.cells.map((cell) => cell.status)).toEqual([
      "passed",
      "deferred",
    ]);
    expect(report.cells[1]).toMatchObject({
      observed: null,
      reason: productBDeferred,
    });
  });

  it("turns red on a live cell that was not checked", () => {
    const report = evaluatePass({
      cells: [readsProductA, deniedProductB],
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
      cells: [readsProductA],
      observations: [],
      problems: [
        {
          cellId: readsProductA.id,
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
      cells: [readsProductA],
      observations: [{ cellId: readsProductA.id, observed: "denied" }],
      deployedSha,
    });

    expect(report.verdict).toBe("red");
    expect(report.cells[0]?.status).toBe("failed");
  });

  it("does not let an observation of a deferred cell change its status", () => {
    const report = evaluatePass({
      cells: [deniedProductB],
      observations: [{ cellId: deniedProductB.id, observed: "allowed" }],
      deployedSha,
    });

    expect(report.verdict).toBe("green");
    expect(report.cells[0]?.status).toBe("deferred");
  });

  it("refuses an observation for a cell outside the configuration", () => {
    expect(() =>
      evaluatePass({
        cells: [readsProductA],
        observations: [
          { cellId: readsProductA.id, observed: "allowed" },
          { cellId: "unknown", observed: "allowed" },
        ],
        deployedSha,
      }),
    ).toThrow("unknown");
  });

  it("turns red after deploy when the deployed SHA is missing", () => {
    const observations = [
      { cellId: readsProductA.id, observed: "allowed" as const },
    ];
    const afterDeploy = evaluatePass({
      cells: [readsProductA],
      observations,
      deployedSha: null,
      deployedShaRequired: true,
    });
    const manual = evaluatePass({
      cells: [readsProductA],
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
  it("defers only Product B and video cells, each with its owner decision", () => {
    const cells: readonly PassCell[] = passCells;
    const reasons = cells.map((cell) => {
      const { action, state, surface } = passCellParts(cell.id);
      if (
        action === "read-product-b" ||
        (state === "learner-product-b" && action !== "read-product-a")
      )
        return [cell.deferred, productBDeferred];
      if (surface === "video") return [cell.deferred, videoDeferred];
      return [cell.deferred, undefined];
    });

    for (const [actual, expected] of reasons) expect(actual).toBe(expected);
    expect(cells.filter((cell) => cell.deferred === undefined).length).toBe(30);
  });

  it("reads every Product surface in the browser and body and practice through learner MCP too", () => {
    const ids = new Set<string>(passCells.map(({ id }) => id));
    const rows = new Set(
      passCells
        .map(({ id }) => id.split("@")[0] ?? "")
        .filter((row) => row.includes("/read-product-")),
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
    expect(() => passCellParts("teacher/read-product-a/body@browser")).toThrow(
      "Malformed",
    );
    expect(() =>
      passCellParts("anonymous/read-product-a/body@telegram"),
    ).toThrow("Malformed");
  });
});

describe("production access pass report", () => {
  it("renders the level of every cell, every status and the blocked requests", () => {
    const markdown = renderPassMarkdown(
      evaluatePass({
        cells: [readsProductA, deniedProductB],
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
    expect(markdown).toContain(`| production | ${productBDeferred} |`);
    expect(markdown).toContain(
      "- `POST https://inside.sachkov.dev/api/reading-progress/states`",
    );
  });

  it("turns red when the browser sent a redirect step outside the allowlist", () => {
    const report = evaluatePass({
      cells: [readsProductA],
      observations: [{ cellId: readsProductA.id, observed: "allowed" }],
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
      cells: [readsProductA],
      observations: [
        {
          cellId: readsProductA.id,
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

describe("production access pass problem line", () => {
  it("names the fields of a response of the wrong shape", () => {
    const parsed = z
      .object({ ok: z.literal(true), value: z.object({ data: z.string() }) })
      .safeParse({ ok: true, result: {} });

    expect(parsed.success).toBe(false);
    expect(problemLine(parsed.error)).toMatch(/^ответ не той формы: value — /u);
    expect(problemLine(new Error("first line\nstack"))).toBe("first line");
  });
});

describe("test identity email", () => {
  it("uses the existing learner aliases for canonical Product roles", () => {
    expect(identityEmail("owner@example.test", "learner-product-a")).toBe(
      "owner+inside-access-learner-guide-a@example.test",
    );
    expect(identityEmail("owner@example.test", "learner-product-b")).toBe(
      "owner+inside-access-learner-guide-b@example.test",
    );
  });

  it.each([
    ["no-entitlement", "owner+inside-access-no-entitlement@example.test"],
    ["expired", "owner+inside-access-expired@example.test"],
    ["materials-only", "owner+inside-access-materials-only@example.test"],
    ["billing-only", "owner+inside-access-billing-only@example.test"],
  ] as const)("keeps the existing alias for %s", (identity, email) => {
    expect(identityEmail("owner@example.test", identity)).toBe(email);
  });

  it("rejects a mailbox that is already an alias", () => {
    expect(() =>
      identityEmail("owner+x@example.test", "learner-product-a"),
    ).toThrow("plain address");
  });
});

describe("production access pass targets", () => {
  it("uses the primary Web domain and retains MCP and API audience", () => {
    expect(productionTarget.web).toBe("https://sachkov.dev");
    expect(productionTarget.learnerMcp).toBe(
      "https://inside.sachkov.dev/mcp/learning",
    );
    expect(productionTarget.ownerMcp).toBe("https://inside.sachkov.dev/mcp");
    expect(productionTarget.apiResource).toBe("https://api.inside.sachkov.dev");
  });
});
