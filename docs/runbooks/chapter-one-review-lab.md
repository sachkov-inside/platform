# Chapter-one learner review lab

This lab is for automated local experiments commissioned on 18 October 2026. The owner will test
the real learner setup separately in production. It does not operate the shared `inside-platform`
stand, import into it, or require its lifecycle ownership.

## Frozen scope

`tools/practice-review/native/chapter-one/snapshot.json` freezes the three active `project-setup`
Tasks from Engineering Content commit `fa377a84879e395dc6cf42aacd2b48c55121156d`:

- `aie-ch1-harness`;
- `aie-ch1-running-skeleton`;
- `aie-ch1-quality-checks`.

The snapshot contains the authored definitions, source paths and original YAML SHA-256 values.
Working-copy edits, legacy Tasks and later chapters are excluded. The fixture database versions
are local versions, not a claim about versions on another stand. Refreshing this snapshot is an
explicit new experiment: use `freeze.py` with a full committed Content revision, inspect the
criteria and update the expectations before running models. Python with PyYAML is needed only
for that refresh; normal runs use repository-owned files.

## Run

Use the repository-pinned Node and pnpm, Docker, and installed workspace dependencies. Build the
agent image before experiments:

```bash
pnpm practice-review:chapter-one:build
pnpm practice-review:chapter-one --contracts
pnpm practice-review:chapter-one
```

The final command invokes a real model and consumes its normal account allowance. The host relay
currently supports an existing file-backed ChatGPT Codex login in `~/.codex/auth.json`; it does not
implement API-key login, keychain-only login or token refresh. Authentication files remain on the
host. Never copy them into the image, project, reports or a repository. Login problems are a failed
experiment, not permission to disable authentication or TLS.

Select a bounded subset when diagnosing a result:

```bash
pnpm practice-review:chapter-one --scenario missing-evidence --task aie-ch1-harness
pnpm practice-review:chapter-one --scenario defect
```

`--model` selects the requested model (default `gpt-6.1-sol`). `--timeout` bounds each model turn
in milliseconds; timeout and infrastructure errors remain failures. `--output` must name a new
directory. At most two independent Tasks are reviewed concurrently within each scenario; scenarios run sequentially. The default output is `.reports/chapter-one-lab/<run UUID>`.

## Isolation and execution

Each run owns a disposable PostgreSQL container with the actual Platform schema and capability
implementations. Frozen definitions are seeded as test fixtures; the authoring import is not part
of this experiment. The real learner HTTP/MCP adapter verifies a synthetic learner token. The host
obtains synthetic PKCE grants; the native agent does not perform Logto onboarding. No product
authentication rule is changed.

Every review gets a new non-root container, a temporary profile/history, a read-only project and
root filesystem, and no host home or Docker socket. Project skills remain discoverable. The
selected skills are the existing Platform workspace adaptations with their provenance; this is
not an assertion that the entire upstream Matt Pocock set was installed.

A trusted short-lived network helper configures OUTPUT filtering in that container's network
namespace. The reviewing agent has no network-administration capability. Non-loopback traffic is
limited to the temporary host relay IPv4 address and port; non-loopback IPv6 is blocked. Before a
model starts, probes check the relay and refusal of host ports 3000–3002, project writes, host-home
mounts, provider credentials and the Docker socket. The relay requires a per-review capability,
accepts only model Responses requests for the selected model and learner MCP POST requests, and
injects the real provider credential only on the host for the fixed official provider endpoint.

The outside runner prepares projects and execution observations before reviewing. Its generated
sample Compose file has its own UUID-derived project name, ephemeral loopback frontend port,
disposable database and network. It never uses the repository's shared Compose file or project.
It runs the real Vue frontend, Fastify backend, PostgreSQL and Chromium technical-health path,
then destroys and restarts the sample stack. Reviewers read these observations; they have not
consented to execute the project themselves.

## Scenarios and verdicts

The matrix includes local execution evidence, an alternative arrangement of instructions, a known
defect, missing execution evidence, and an instruction-injection attempt accompanying a real
defect. Expected statuses are authored outside the project and model prompt. An injection verdict
also requires an observed encounter with the injected text.

There is deliberately no fake GitHub success. The fixture has no remote repository, live Issues,
labels, PR, independent PR review, CI run or merge. These gaps must remain explicit. Some local
properties can be confirmed while the whole assignment remains incomplete. A report must not
mark a complete criterion confirmed while its required evidence remains missing.

The machine gates check full context parts/hashes, criterion coverage and expected statuses,
evidence/gap presence, consent boundaries, no early submission, unchanged files and persistence.
Only after seeing a conforming exact report does the runner send an explicit scripted confirmation.
It confirms code, reviewed version, report, note and the nullable service mark. Submitted fields must match exactly (null mark fields are omitted from the request). A successful receipt must identify the same task/version; history must contain that exact submission ID and content. The runner also retries the same submission. The
contract-only run separately covers history isolation, author feedback and obsolete versions.

The command audit is a conservative recognizer of recorded events, not an isolation boundary.
Unknown syntax needs inspection of `unconsentedCommands` and the transcript before concluding that
the agent executed the project. `run-claim-needs-review` also blocks automatic confirmation:
read-only Git commands can expose an ambiguity in the protocol's `obtainedByRun` wording.

See the [first chapter-one experiment](../verification/chapter-one-review-lab.md) for preserved
machine outcomes, semantic findings and corrected-fixture reruns.

Machine results do not establish pedagogical quality. Inspect the full reports for specific,
actionable comments, acceptance of permitted alternatives, unsupported success claims and the
distinction between absent evidence and an observed defect. Preserve failures and invalid harness
runs; successful later trials do not erase them.

## Evidence and cleanup

`summary.json` records Content/source/image identities, a digest of lab inputs, working-copy state,
contract outcomes, every trial and limitations. Each trial retains its report, confirmation,
MCP observations, commands, isolation probes and local agent events. Raw reports are local ignored
artifacts, not material to publish wholesale. Publish only inspected summaries without credentials
or personal learner data.

Normal completion, failure, timeout and catchable interruption run owned-resource cleanup. Cleanup
errors are failures, and labelled containers/networks are checked for absence. A detached watchdog
registers resource labels before acquisition and cleans them when its parent pipe closes, including
an uncatchable parent termination. Its report is `watchdog.json`. Killing the watchdog itself or a
Docker failure still requires recovery inspection; a review container also has a 30-minute maximum lifetime. Inspect
only the exact run/trial labels recorded in its reports. Never prune Docker globally or remove the
shared stand's containers, volumes or network.

## Separate production acceptance

This lab does not certify native OAuth/Logto callbacks, refresh, public edge routing, Reader UI,
published course versions, live GitHub delivery, legal publication or production submission flags.
Follow [learner practice review](learning-practice-review.md) for those acceptance steps. The
protocol version returned by this source is recorded by the MCP context; it may differ from another
running stand. Passing this lab does not release or publish anything.
