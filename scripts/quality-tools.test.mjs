// @ts-check
import assert from "node:assert/strict";
import { it } from "node:test";
import { verifyToolDownload } from "./quality-tools.mjs";

it("accepts the pinned bytes and rejects a substituted download before execution", () => {
  const digest =
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
  assert.doesNotThrow(() => verifyToolDownload(Buffer.from("hello"), digest));
  assert.throws(
    () => verifyToolDownload(Buffer.from("changed"), digest),
    /checksum mismatch/u,
  );
});
