// @ts-check
import { migrationsIdentity } from "./release-contract.mjs";

// The 39 migrations shipped before #1770. New files sort after this immutable prefix.
// Updating the current release identity never changes this historical identity.
const expected =
  "sha256:01876aac073c5a8c3d319994bbda6d9c0b98c81d9d6091ae3cdf3000af8f456c";
const historical = await migrationsIdentity(process.argv[2], 39);
if (historical.identity !== expected) {
  console.error(
    "Telegram historical migration changed: append a migration instead of editing, deleting or renaming shipped files.",
  );
  process.exitCode = 1;
} else console.log("Telegram historical migration prefix is unchanged.");
