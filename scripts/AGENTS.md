# Repository scripts

Use this context when changing or reviewing root scripts. Root `WORKFLOW.md` owns delivery;
the root coding standards remain review inputs.

## Implementation context

- Repository `.mjs` scripts use `// @ts-check`, `tsconfig.scripts.json` and the shared type-aware
  lint rules. Compiler presets and strictness are owned by the root `tsconfig*.json` files;
  [toolchain contracts](toolchain-contract.test.mjs) verify their configuration.
- Parse external JSON and rows with a schema or retain `unknown` until an explicit check.
  [package-manifest.mjs](package-manifest.mjs) owns the `package.json` parser.
- When `createRequire` loads an application's dependency, take its type from that application's
  `test/support/proof-dependencies`. Relative type imports into `node_modules` cannot resolve
  the package's own imports. Keep the `any` assertion inside an
  `oxlint-disable`/`oxlint-enable` block for `typescript/no-unsafe-type-assertion`;
  `disable-next-line` inside a JSDoc cast does not suppress that diagnostic.
- Declare module values before a top-level call to a function that reads them. The
  [initialization-order check](check-module-initialization-order.mjs) does not cover callbacks
  executed immediately, such as a `.map()` callback; review those dependencies explicitly.
- Propagate failure through exit status. Shell scripts support macOS Bash 3.2: use neither
  `wait -n` nor empty-array expansion under `set -u`.

## Verification

Run the affected script contracts through `bash scripts/heavy-check.sh node --test <test-files>`
from the repository root. Process-owning scripts follow root deterministic test contracts;
verify actual cleanup on success, failure, timeout and interruption.
