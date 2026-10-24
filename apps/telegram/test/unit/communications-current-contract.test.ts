import { expect, it } from "vitest";
import { validRequest } from "../../src/modules/communications/communications-contract.js";

it("admits canonical Sequence commands and rejects the retired writable Funnel envelope", () => {
  const command = {
    contractVersion: "inside-communications-v2",
    operation: "sequences.read",
    operationId: "60000000-0000-4000-8000-000000000001",
    expectedRevision: 0,
    actor: { accountRef: "60000000-0000-4000-8000-000000000002" },
    payload: { sequenceId: "60000000-0000-4000-8000-000000000003" },
  };
  expect(validRequest(command)).toBe(true);
  expect(
    validRequest({
      ...command,
      contractVersion: "inside-communications-v1",
      operation: "funnels.read",
      payload: { funnelId: command.payload.sequenceId },
    }),
  ).toBe(false);
});
