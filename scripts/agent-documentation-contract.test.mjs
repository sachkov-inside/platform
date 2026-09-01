import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  checkDocumentation,
  extractLocalMarkdownTargets,
} from "./check-agent-documentation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("agent documentation contract", () => {
  it("keeps current agent pointers and Materials documentation consistent", () => {
    assert.deepEqual(checkDocumentation(repositoryRoot), []);
  });

  it("extracts repository pointers without treating external links as files", () => {
    const markdown = [
      "[local](../CONTEXT.md#material)",
      "[external](https://example.com/reference)",
      "[anchor](#completion)",
      "[route](/materials/example)",
    ].join("\n");

    assert.deepEqual(extractLocalMarkdownTargets(markdown), ["../CONTEXT.md"]);
  });
});
