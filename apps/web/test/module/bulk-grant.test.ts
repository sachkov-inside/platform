import { describe, expect, it, vi } from "vitest";

import { issueProductAccessOperation } from "@/entities/subscription";
import {
  BULK_GRANT_LIMIT,
  bulkGrantSourceRef,
  createBulkGrantBatch,
  failedAccountIds,
  precheckOutcome,
  runBulkGrant,
  type BulkGrantIssueInput,
  type BulkGrantIssueResult,
  type BulkGrantRowResult,
  type BulkGrantSend,
} from "@/features/product-holders/model/bulk-grant";

const productId = "20000000-0000-4000-8000-000000000001";
const batchId = "30000000-0000-4000-8000-000000000001";

function accountId(index: number): string {
  return `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function people(count: number): string[] {
  return Array.from({ length: count }, (_, index) => accountId(index + 1));
}

function batchOf(accountIds: readonly string[]) {
  return createBulkGrantBatch({
    batchId,
    productId,
    reason: "  Подарок  ",
    accountIds,
  });
}

const issued: BulkGrantIssueResult = {
  ok: true,
  value: { outcome: "issued" },
};

describe("bulk grant batch", () => {
  it("takes at most 50 people, at least one, and a reason", () => {
    expect(BULK_GRANT_LIMIT).toBe(50);
    expect(batchOf(people(50)).accountIds).toHaveLength(50);
    expect(() => batchOf(people(51))).toThrow(RangeError);
    expect(() => batchOf([])).toThrow(RangeError);
    expect(() =>
      createBulkGrantBatch({
        batchId,
        productId,
        reason: "   ",
        accountIds: people(1),
      }),
    ).toThrow(RangeError);
  });

  it("counts a person once and trims the reason", () => {
    const [first = "", second = ""] = people(2);
    const batch = batchOf([first, second, first]);
    expect(batch.accountIds).toEqual([first, second]);
    expect(batch.reason).toBe("Подарок");
  });

  it("names each issue by batch and person", () => {
    expect(bulkGrantSourceRef(batchId, accountId(7))).toBe(
      `admin-bulk:${batchId}:${accountId(7)}`,
    );
    // Product Access takes a source reference of up to 256 characters.
    expect(bulkGrantSourceRef(batchId, accountId(7)).length).toBeLessThan(256);
  });

  it("the single issue operation is the send the loop takes", () => {
    const send: BulkGrantSend = issueProductAccessOperation.send;
    expect(send).toBe(issueProductAccessOperation.send);
  });
});

describe("bulk grant run", () => {
  it("maps each answer to the person's outcome and goes on after a failure", async () => {
    const answers: Record<string, () => Promise<BulkGrantIssueResult>> = {
      [accountId(1)]: () => Promise.resolve(issued),
      [accountId(2)]: () =>
        Promise.resolve({ ok: true, value: { outcome: "already_active" } }),
      [accountId(3)]: () =>
        Promise.resolve({ ok: true, value: { outcome: "revoked" } }),
      [accountId(4)]: () => Promise.resolve({ ok: false, code: "not_found" }),
      [accountId(5)]: () => Promise.reject(new Error("network")),
    };
    const send = vi.fn((input: BulkGrantIssueInput) => {
      const answer = answers[input.accountId];
      if (answer === undefined) throw new Error("unexpected person");
      return answer();
    });
    const reported: BulkGrantRowResult[] = [];
    const results = await runBulkGrant(
      batchOf(people(5)),
      people(5),
      send,
      (result) => reported.push(result),
    );
    expect(results).toEqual([
      { accountId: accountId(1), outcome: "issued" },
      { accountId: accountId(2), outcome: "already_active" },
      { accountId: accountId(3), outcome: "revoked" },
      { accountId: accountId(4), outcome: "error", code: "not_found" },
      { accountId: accountId(5), outcome: "error", code: "unavailable" },
    ]);
    expect(reported).toHaveLength(5);
    expect(send).toHaveBeenCalledWith({
      accountId: accountId(1),
      productId,
      sourceRef: `admin-bulk:${batchId}:${accountId(1)}`,
      reason: "Подарок",
    });
  });

  it("retries only the failed rows with the same references and reason", async () => {
    const batch = batchOf(people(4));
    const first = vi.fn((input: BulkGrantIssueInput) =>
      Promise.resolve<BulkGrantIssueResult>(
        input.accountId === accountId(2) || input.accountId === accountId(4)
          ? { ok: false, code: "unavailable" }
          : issued,
      ),
    );
    const results = new Map(
      (await runBulkGrant(batch, batch.accountIds, first)).map((result) => [
        result.accountId,
        result,
      ]),
    );
    const failed = failedAccountIds(results);
    expect(failed).toEqual([accountId(2), accountId(4)]);

    const retry = vi.fn((_input: BulkGrantIssueInput) =>
      Promise.resolve(issued),
    );
    const repeated = await runBulkGrant(batch, failed, retry);
    expect(repeated.map((result) => result.outcome)).toEqual([
      "issued",
      "issued",
    ]);
    expect(retry.mock.calls.map(([input]) => input)).toEqual(
      first.mock.calls
        .map(([input]) => input)
        .filter((input) => failed.includes(input.accountId)),
    );
  });

  it("refuses to send anyone outside the batch", async () => {
    const send = vi.fn(() => Promise.resolve(issued));
    await expect(
      runBulkGrant(batchOf(people(2)), [accountId(9)], send),
    ).rejects.toThrow(RangeError);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps at most two issues in flight", async () => {
    const pending: (() => void)[] = [];
    let inFlight = 0;
    let most = 0;
    const send = vi.fn(
      () =>
        new Promise<BulkGrantIssueResult>((resolve) => {
          inFlight += 1;
          most = Math.max(most, inFlight);
          pending.push(() => {
            inFlight -= 1;
            resolve(issued);
          });
        }),
    );
    const run = runBulkGrant(batchOf(people(5)), people(5), send);
    for (let settled = 0; settled < 5; settled += 1) {
      await vi.waitFor(() => {
        expect(pending.length).toBeGreaterThan(0);
      });
      expect(inFlight).toBeLessThanOrEqual(2);
      pending.shift()?.();
    }
    expect(await run).toHaveLength(5);
    expect(most).toBe(2);
    expect(send).toHaveBeenCalledTimes(5);
  });

  it("reads a known access from the pre-check without sending", () => {
    expect(precheckOutcome("active")).toBe("already_active");
    expect(precheckOutcome("revoked")).toBe("revoked");
  });
});
