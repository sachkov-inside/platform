import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateTelegramSignInTheme } from "./telegram-sign-in-theme.mjs";

test("Logto sign-in uses the current Platform light tokens and pinned local fonts", async () => {
  const committed = await readFile(new URL("../infra/identity/logto/fork/packages/core/src/routes/inside-telegram-theme.ts", import.meta.url), "utf8");
  assert.equal(committed, await generateTelegramSignInTheme());
});
