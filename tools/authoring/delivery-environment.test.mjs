// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertPinnedNode,
  pinnedNode,
  prepareTrustedNetwork,
} from "./delivery-environment.mjs";
import { refusalCode } from "./refusal.mjs";

test("the pinned Node version is required exactly, with the command that satisfies it", () => {
  assert.match(pinnedNode(), /^\d+\.\d+\.\d+$/u);
  assertPinnedNode(pinnedNode(), pinnedNode());
  assert.throws(
    () => assertPinnedNode("24.19.0", "26.10.0"),
    (error) =>
      refusalCode(error) === "node_version" &&
      /requires Node 26\.10\.0.*runs 24\.19\.0.*fnm exec --using 26\.10\.0/u.test(
        String(error),
      ),
  );
});

test("trusted hosts must resolve to real addresses; VPN fake DNS answers are refused", async () => {
  /** @type {Record<string, { address: string; family: number }[]>} */
  const answers = {
    "inside.sachkov.dev": [{ address: "147.45.166.174", family: 4 }],
    "auth.sachkov.dev": [{ address: "198.18.0.12", family: 4 }],
  };
  const resolve = async (/** @type {string} */ host) => {
    const answer = answers[host];
    if (answer === undefined) throw new Error(`ENOTFOUND ${host}`);
    return answer;
  };
  assert.deepEqual(
    await prepareTrustedNetwork(["inside.sachkov.dev"], resolve),
    {
      "inside.sachkov.dev": ["147.45.166.174"],
    },
  );
  await assert.rejects(
    prepareTrustedNetwork(["inside.sachkov.dev", "auth.sachkov.dev"], resolve),
    (error) =>
      refusalCode(error) === "network_fake_dns" &&
      /198\.18\.0\.12/u.test(String(error)),
  );
  await assert.rejects(
    prepareTrustedNetwork(["missing.sachkov.dev"], resolve),
    (error) => refusalCode(error) === "network_dns",
  );
});
