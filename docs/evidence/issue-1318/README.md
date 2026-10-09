# #1318 — local build input / CSP evidence

Canonical task: [Platform#1318](https://github.com/sachkov-inside/platform/issues/1318), linked to
normal-stand [#1304](https://github.com/sachkov-inside/platform/issues/1304) in PR1308.

## Original browser red

Content's genuine learner receipt `shared-csp-1318.json`, captured2026-10-09T23:00:39.360Z in its
private transfer56, records host tooling3917205c7d792f79d7f0a5bd6a319999221ce346 / actual
runtime de9cf10a90214ea49586059eddcbcc9d33f6cf31. An authorized closed Reader returned200, but
`img-src` lacked `http://127.0.0.1:9000`. Both expected protected image requests failed with
resourceType=image / error=csp; remaining images0. Console records that blocked origin. Screenshot
`shared-csp-1318-route.png`, route snapshot `shared-csp-1318-route.yml` and human proof
`shared-csp-1318-proof.md` remain with Content. Canonical issue/handoff retain their exact local
paths. Signed query parameters, cookies and authorization are excluded; no private artifact is
copied into the repository. The learner grant/MCP evidence separately establishes authorized
access; this receipt's image failure is the browser's CSP denial.

## Causal source/config red and green

Pre-agreed seam: normal Compose build inputs and `next.config.ts` headers, including the published
`OBJECT_STORAGE_HOST_PORT`. New `apps/web/test/contracts/local-stand-csp.test.ts` resolves real
Compose config with service env resolution disabled, an empty project env file and a deliberately
absent Docker engine. It executes no build, registry or live-stand operation. Resolved CSP input
feeds the actual Next config header function. The separate source assertion checks ARG declaration
in the production-build stage; it does not claim a real Docker build ran.

Before the fix, three tests failed: both default9000 and configured9157 local headers contained no
HTTP image origin, and the production-build ARG was absent. Raw command/result logs remain in the
writer's `.reports/1304/csp-source-config-red.log` (exit1). After the fix, the exact configured
origin is present once. API/MCP signed GET endpoints follow that same host port through the common
learner overlay, in both normal modes. Changing a runtime env after importing the config leaves
its captured header unchanged. The existing production-default/no-loopback and invalid-origin
rejection tests remain green; script policy is unchanged. Raw green logs are retained in handoff.

The narrow fix passes the existing validated `CSP_LOCAL_OBJECT_STORAGE_ORIGIN` as a local Compose
build argument and declares it only in the Docker production-build stage, after dependencies and
before Next build. Default release ARG is empty. [Docker's ARG contract](https://docs.docker.com/reference/cli/docker/buildx/build/)
passes build arguments to RUN as environment; it does not make them final runtime ENV. Installed
Next16.3.8 `dist/lib/load-custom-routes.js` reads config headers; `dist/build/index.js` passes them
to the generated routes manifest. The LIGHT proof exercises the source/config boundary, not the
built manifest, HTTP response or protected image rendering.

## Still pending

Separate root sole-heavy signal, actual standard build/start in both modes, baked CSP/header,
genuine protected image rendering/anonymous denial and data preservation. Content then resumes
all133-source-asset browser delivery at1440/390. No full asset PASS, final check0 or current CI green
is asserted here. Keep the current FULL course/journal/submissions and identity data; restore no
old09October backup over the current state. [The refreshed budget](../issue-1304/resume-1318/README.md)
retains start20 GiB / ceiling8 GiB / floor10 GiB with256 MiB stop margin; actual growth is pending.
