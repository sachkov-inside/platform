// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import { authoringImportContract } from "../../apps/backend/src/modules/materials/domain/authoring-import-contract.ts";
import { assertReceiverContract, clientContractVersion } from "./contract.mjs";
import { supportedPackageFeatures } from "./package.mjs";

test("client and receiver of one revision speak the same contract and package features", () => {
  assert.equal(authoringImportContract.version, clientContractVersion);
  assert.deepEqual(
    [...authoringImportContract.packageFeatures],
    [...supportedPackageFeatures],
  );
});

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
  /** @type {[Record<string, unknown>, string[], RegExp][]} */
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
