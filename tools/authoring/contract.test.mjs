// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import { assertReceiverContract } from "./contract.mjs";

test("the handshake refuses a missing, different or incomplete receiver contract", () => {
  const contract = {
    version: 1,
    packageFeatures: ["quiz-v1", "bounded-content-v1"],
  };
  assert.deepEqual(
    assertReceiverContract(
      { mode: "production", contract },
      { requiredFeatures: ["bounded-content-v1"] },
    ),
    contract,
  );
  /** @type {[Parameters<typeof assertReceiverContract>[0], string[], RegExp][]} */
  const refused = [
    [{ mode: "production" }, [], /predates the import contract/u],
    [
      { mode: "production", contract: { ...contract, version: 2 } },
      [],
      /contract 2; this client speaks 1/u,
    ],
    [
      { mode: "production", contract },
      ["image-variants-v1"],
      /image-variants-v1/u,
    ],
    [
      {
        mode: "production",
        contract: { ...contract, packageFeatures: ["future-v9"] },
      },
      ["future-v9"],
      /future-v9/u,
    ],
  ];
  for (const [environment, requiredFeatures, message] of refused)
    assert.throws(
      () => assertReceiverContract(environment, { requiredFeatures }),
      message,
    );
});
