import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { signalProcessGroup } from "./process-group-signal.mjs";

describe("process-group signalling", () => {
  it("allows a direct-child fallback when the process group cannot be signalled", () => {
    const permissionError = new Error("operation not permitted");
    permissionError.code = "EPERM";

    assert.equal(
      signalProcessGroup(123, "SIGTERM", () => {
        throw permissionError;
      }),
      false,
    );
  });
});
