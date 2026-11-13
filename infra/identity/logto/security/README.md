# Logto dependency security maintenance (#2117)

This directory freezes a compatible dependency refresh of the immutable Logto 1.46.0 source
(`d179bf9d2d51104236a342b90c2841df66e4ba5b`). The upstream image includes its virtual-store lock,
but omits the root workspace declaration and pnpm CLI. We restore the upstream workspace paths,
apply `manifest-overlay.json`, and install `pnpm-lock.yaml` with pnpm 10.34.9 and a frozen lock.
Logto declares pnpm 9/10 support; the application workspace independently uses pnpm 12.
The first resolution observed the repository's 1440-minute release quarantine. Builds never resolve
new versions. Core and all three browser applications are rebuilt before production-only pruning.
The existing Inside SMTP, Telegram sign-in, account-email and offline-consent patches remain applied.

## Private security patches

| Patch | Source and scope | Removal condition |
|---|---|---|
| `@remix-run/router@1.23.4`, `react-router-dom@6.30.6` | Backport of [React Router #15176](https://github.com/remix-run/react-router/pull/15176), [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6). Normalize mixed slash/backslash paths in navigation and absolute-link classification. Published CommonJS, ESM and UMD variants are patched; production UMD variants retain upstream license banners. | Compatible upstream Logto admits React Router >=7.18.0 or a maintained 6.x release carries the fix. |
| `zod@3.24.3` | Backport of [Zod #6652](https://github.com/colinhacks/zod/pull/6652), commit `a0ebf970f2d752e5f58527cd2942ff48be4f46bd`, for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Reject arrays/sets exceeding an explicit upper bound before visiting elements, in CommonJS and ESM. Lower-bound errors, union alternatives and catch fallbacks keep their semantics. | Logto and `@withtyped/server` support a fixed Zod major or a maintained 3.x release carries this fix. |
| `deepmerge@4.3.1` | Local fix for [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), with no published fixed release. Exclude the special `__proto__` key from both target cloning and source merging. Symbol keys and normal nested/array merges remain supported. Same patch bytes as the root workspace. | A compatible upstream release fixes prototype poisoning. |

The Zod 4 experiment failed the declared `@withtyped/server@0.14.0` Zod 3 peer contract and
introduced incompatible router/schema types. The backport avoids bypassing that contract.
It bounds explicitly constrained collections; it does not impose a new cap on unbounded arrays.
Logto's upstream `koa-guard` separately limits accumulated issues. Its comments identify unions and
catch schemas as limits of that mitigation. These facts are not a claim of universal input bounds.

React Router [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg) concerns manual
SSR/hydration. Logto account, console and experience mount client applications; this image does not
use that SSR/hydration path. Version-based scanners continue to report the original package versions
for the private backports. Do not suppress or rename versions to hide those findings.

## Proofs

The Docker build executes `router-security.mjs`, `zod-security.mjs` and `deepmerge-security.mjs`
against the installed dependency graph. They cover malicious paths, relative navigation, rejected
oversized collections with zero element callbacks (including async, union and catch), and poisoned
objects with null/own-property prototypes. Root `scripts/deepmerge-security.test.mjs` independently
covers the workspace patch. Each regression first failed against the unpatched release.

After rebuilding the canonical image, run the account-email protocol/browser proof and the
foundation/native recovery jobs required by the repository. A successful dependency build or audit
alone is insufficient evidence for release or deployment.
