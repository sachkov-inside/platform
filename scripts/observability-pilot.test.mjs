// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const CORE_SOURCE_TIMEOUT_MS = 60000;

if (
  process.platform !== "linux" ||
  process.env["INSIDE_CORE_SOURCE_PROGRESS"] !== "1"
) {
  // deterministic-test-allow unit-io: Python owns bounded local process/loopback contracts; no Docker or live providers.
  test("observability pilot preparation preserves admission and private query boundaries", () => {
    const result = spawnSync(
      "python3",
      [
        "-m",
        "unittest",
        "discover",
        "-s",
        "scripts/observability-pilot",
        "-p",
        "test_*.py",
      ],
      { encoding: "utf8", timeout: CORE_SOURCE_TIMEOUT_MS },
    );
    assert.equal(result.status, 0, result.stderr);
  });
} else {
  // deterministic-test-allow unit-io: synchronous Python source lifetime with a shared 60s aggregate guard; fixed markers add no process containment guarantee.
  test("observability pilot preparation preserves admission and private query boundaries", async () => {
    const { assertCoreContracts } =
      await import("./observability-pilot/source-progress.mjs");
    const result = spawnSync(
      "python3",
      ["scripts/observability-pilot/source_runner.py"],
      { encoding: "utf8", timeout: CORE_SOURCE_TIMEOUT_MS },
    );
    assertCoreContracts(result);
  });
}

test("Core passive progress validates the entire bounded fixed prefix", async () => {
  const { readFile } = await import("node:fs/promises");
  const { sourceProgress, assertCoreProtocolContracts } =
    await import("./observability-pilot/source-progress.mjs");
  /** @type {unknown} */
  const raw = JSON.parse(
    await readFile("scripts/observability-pilot/source-tests.json", "utf8"),
  );
  assert.ok(
    Array.isArray(raw) &&
      raw.length === 307 &&
      raw.every((value) => typeof value === "string"),
  );
  const additions = [
    "test_archive_download.ArchiveDownload.test_actual_stdlib_child_preserves_exact_parent_size_digest_and_finite_transport_failure",
    "test_archive_download.ArchiveDownload.test_interrupt_keeps_original_object_traceback_after_kill_reap_and_secondary_cleanup_error",
    "test_archive_download.ArchiveDownload.test_invalid_pinned_size_refuses_before_any_child",
    "test_archive_download.ArchiveDownload.test_original_parent_total_budget_includes_real_TLS_handshake_and_reaps_child_pipes",
    "test_archive_download.ArchiveDownload.test_real_TLS_trickle_cannot_complete_valid_archive_after_original_total_budget",
    "test_archive_download.ArchiveDownload.test_timeout_keeps_actual_first_exception_and_reaps_despite_secondary_cleanup_error",
    "test_archive_download.ArchiveDownload.test_timeout_still_waits_after_actual_kill_raises_secondary_error",
    "test_pilot.PilotPreparationTest.test_cleanup_captures_native_host_failure_before_down_without_reading_logs",
    "test_pilot.PilotPreparationTest.test_native_host_failure_witness_uses_actual_exit_and_refuses_foreign_owner",
    "test_privacy.CollectorPrivacyContract.test_shared_native_writer_keeps_one_second_batch_without_other_queue_overrides",
    "test_ci.FiniteRejectionCollectionTests.test_absent_diagnostic_stays_absent",
    "test_ci.FiniteRejectionCollectionTests.test_basename_aliases_never_reach_generic_copy",
    "test_ci.FiniteRejectionCollectionTests.test_every_changed_runtime_byte_and_map_membership_are_freshly_bound",
    "test_ci.FiniteRejectionCollectionTests.test_exact_file_cap_is_reconstructed_and_foreign_owner_or_read_race_is_refused",
    "test_ci.FiniteRejectionCollectionTests.test_only_strict_projection_is_collected_for_default_and_explicit_selection",
    "test_ci.FiniteRejectionCollectionTests.test_private_file_and_closed_schema_attacks_are_refused_before_publication",
    "test_ci.FiniteRejectionCollectionTests.test_stale_sha_tree_dirty_source_and_private_source_replacement_refuse",
    "test_ci.QueryHelperAdmissionTests.test_actual_collect_validates_before_execution_and_never_reopens_or_reuses_query_code",
    "test_ci.QueryHelperAdmissionTests.test_actual_protected_worker_refuses_mac_before_loading_changed_query_helper",
    "test_ci.RejectionCollectionTests.test_explicit_selection_never_copies_unvalidated_rejection_content",
    "test_source_status.FiniteRejectionContractTests.test_clock_completion_internal_and_actual_output_cap_slots",
    "test_source_status.FiniteRejectionContractTests.test_current_and_previous_context_and_first_rejection_are_preserved",
    "test_source_status.FiniteRejectionContractTests.test_each_parser_branch_has_its_fixed_code_and_vector_slot",
    "test_source_status.FiniteRejectionContractTests.test_projection_rejects_extras_unknowns_bools_and_getters",
    "test_source_status.FiniteRejectionContractTests.test_real_body_and_row_limits_keep_unknown_counts_null",
    "test_source_status.RejectionDiagnosticTests.test_decode_rejection_is_closed_and_public_report_is_unchanged",
    "test_source_status_query.PrivateRejectionTests.test_private_first_refusal_is_source_bound_and_does_not_change_report",
    "test_source_status_query.RejectionSafetyTests.test_diagnostic_exception_or_interruption_cannot_replace_malformed",
    "test_source_status_query.RejectionSafetyTests.test_directory_replacement_after_credentials_keeps_original_anchor",
    "test_source_status_query.RejectionSafetyTests.test_private_existing_file_modes_links_fifo_and_size_are_never_overwritten",
    "test_source_status_query.RejectionSafetyTests.test_public_query_and_private_reader_have_identical_original_report_bytes",
    "test_source_status_query.RejectionSafetyTests.test_source_or_directory_replacement_during_http_refuses_diagnostic_only",
    "test_source_status_query.RejectionSafetyTests.test_temporary_name_collision_and_inode_replacement_refuse_without_leaking",
  ];
  assert.ok(additions.every((id) => raw.includes(id)));
  const baseline = raw.filter((id) => !additions.includes(id));
  assert.equal(baseline.length, 274);
  const { createHash } = await import("node:crypto");
  assert.equal(
    createHash("sha256").update(JSON.stringify(baseline)).digest("hex"),
    "e0fac579823df0df2d5658f678db37241c367c0dcdfe7f840262a903d2512051",
  );
  // Run the real module reader with controlled file bytes, without a second source run.
  const { runInNewContext } = await import("node:vm");
  const reader = (
    await readFile("scripts/observability-pilot/source-progress.mjs", "utf8")
  )
    .replace(/^import [^\n]+;\n/gmu, "")
    .replaceAll("import.meta.url", '"file:///fixed/source-progress.mjs"')
    .replaceAll("export function ", "function ");
  /** @param {Buffer} bytes */
  const readInventory = (bytes) => {
    runInNewContext(reader, {
      readFileSync: () => bytes,
      URL,
      Buffer,
      assert,
    });
  };
  const compact = Buffer.from(JSON.stringify(raw));
  assert.doesNotThrow(() =>
    readInventory(
      Buffer.concat([compact, Buffer.alloc(65536 - compact.length, " ")]),
    ),
  );
  for (const invalid of [
    Buffer.concat([compact, Buffer.alloc(65537 - compact.length, " ")]),
    Buffer.from("NaN"),
    Buffer.from("["),
    Buffer.from("[]"),
    Buffer.from(JSON.stringify(raw.slice(1))),
    Buffer.from(JSON.stringify([...raw].reverse())),
    Buffer.from(JSON.stringify(Array(307).fill(raw[0]))),
    Buffer.from(
      JSON.stringify([
        "test_fixed.Fixed.test_" + "x".repeat(192),
        ...raw.slice(1),
      ]),
    ),
    Buffer.from(JSON.stringify(["test_fixed.Fixed.test_é", ...raw.slice(1)])),
  ])
    assert.throws(() => readInventory(invalid));
  const first = raw[0];
  const second = raw[1];
  assert.ok(typeof first === "string" && typeof second === "string");
  const start = `CORE_SOURCE_V1 start ${first}\n`;
  const completed = `CORE_SOURCE_V1 completed ${first}\n`;
  assert.deepEqual(sourceProgress(start), {
    lastStarted: first,
    lastCompleted: null,
    completedCount: 0,
  });
  assert.deepEqual(sourceProgress(start + completed), {
    lastStarted: first,
    lastCompleted: first,
    completedCount: 1,
  });
  const full = raw
    .map((id) => `CORE_SOURCE_V1 start ${id}\nCORE_SOURCE_V1 completed ${id}\n`)
    .join("");
  assert.equal(Buffer.byteLength(full), 81788);
  assert.equal(sourceProgress(full)?.completedCount, 307);
  for (const invalid of [
    "",
    "legacy private-canary",
    completed,
    start + start,
    start + completed + completed,
    `CORE_SOURCE_V1 start ${second}\n`,
    start + `CORE_SOURCE_V1 completed ${second}\n`,
    start.slice(0, -1),
    start + "CORE_SOURCE",
    start.replace("V1", "V2"),
    start.replace("start", "other"),
    start.replace(first, "private-canary"),
    start.replace("\n", "\r\n"),
    start.replace("start ", "start  "),
    "private-prefix " + start,
    start + "CORE_SOURCE_private-canary\n",
    start + "CORE_SOURCE_é\n",
    full + start,
    start + "CORE_SOURCE" + "x".repeat(131072) + "\n",
    start + "x".repeat(1_048_576),
  ]) {
    assert.equal(sourceProgress(invalid), null);
  }
  assert.equal(
    sourceProgress({
      toString() {
        throw new Error("foreign string");
      },
    }),
    null,
  );
  assert.deepEqual(
    sourceProgress(start + "x".repeat(1_048_576 - Buffer.byteLength(start))),
    { lastStarted: first, lastCompleted: null, completedCount: 0 },
  );
  // deterministic-test-allow unit-io: the fixed separate three-method synthetic entry acquires only private stdio; it never runs the 307 discovered fixtures.
  assertCoreProtocolContracts(
    spawnSync(
      "python3",
      ["scripts/observability-pilot/source_progress_contract.py"],
      { encoding: "utf8", timeout: 30000 },
    ),
  );
});

test("Core passive assertions retain native outcome and redact foreign captures", async () => {
  const { sourceProgress, assertCoreContracts, assertCoreProtocolContracts } =
    await import("./observability-pilot/source-progress.mjs");
  assert.throws(
    () =>
      assertCoreProtocolContracts({
        status: 1,
        signal: null,
        stderr: "private-canary\nCORE_PROTOCOL_V1 failures -F-\n",
      }),
    {
      message:
        /Core protocol: test_markers_preserve_first_primary_and_completed_is_not_success=failure/u,
    },
  );
  for (const field of [
    "exit",
    "program",
    "warnings",
    "tests",
    "failures",
    "errors",
    "skips",
    "discovery",
    "output",
  ]) {
    for (const category of ["F", "E"]) {
      assert.throws(
        () =>
          assertCoreProtocolContracts({
            status: 1,
            signal: null,
            stderr: `private-canary\nCORE_PROTOCOL_V1 failures --${category} field ${field}\n`,
          }),
        (error) =>
          error instanceof assert.AssertionError &&
          error.message.includes(
            "test_runner_uses_original_discovery_and_refuses_inventory_drift=" +
              (category === "F" ? "failure" : "error") +
              "; field=" +
              field,
          ) &&
          !error.message.includes("private-canary") &&
          !error.stack?.includes("private-canary"),
      );
    }
  }
  assert.throws(
    () =>
      assertCoreProtocolContracts({
        status: 1,
        signal: null,
        stderr:
          "private-canary\nCORE_PROTOCOL_V1 failures --F stage source_shape\n",
      }),
    (error) =>
      error instanceof assert.AssertionError &&
      error.message.includes("; stage=source_shape") &&
      !error.message.includes("private-canary"),
  );
  const stages = [
    "owner_import",
    "source_shape",
    "inventory_guard",
    "stdlib_imports",
    "fixture_setup",
    "import_order",
    "execution",
    "record",
    "import_list",
    "comparison_tail",
    "count",
    "exit",
    "refusal",
    "import_guard",
    "import_tail",
  ];
  for (const stage of stages) {
    for (const category of ["F", "E"]) {
      const line = `CORE_PROTOCOL_V1 failures --${category} stage ${stage}\n`;
      assert.ok(Buffer.byteLength(line) <= 64);
      assert.throws(
        () =>
          assertCoreProtocolContracts({
            status: 1,
            signal: null,
            stderr: "private-stage-canary\n" + line,
          }),
        (error) =>
          error instanceof assert.AssertionError &&
          error.message.includes("; stage=" + stage) &&
          !error.message.includes("private-stage-canary") &&
          !error.stack?.includes("private-stage-canary"),
      );
    }
  }
  for (const stderr of [
    "CORE_PROTOCOL_V1 failures --F stage private-stage-canary\n",
    "CORE_PROTOCOL_V1 failures --F stage Exit\n",
    "CORE_PROTOCOL_V1 failures --F stage  exit\n",
    "CORE_PROTOCOL_V1 failures --F stage exit stage count\n",
    "CORE_PROTOCOL_V1 failures --F stage exit field output\n",
    "CORE_PROTOCOL_V1 failures --F field output stage exit\n",
    "CORE_PROTOCOL_V1 failures F-- stage exit\n",
    "CORE_PROTOCOL_V1 failures -E- stage exit\n",
    "CORE_PROTOCOL_V1 failures --- stage exit\n",
    "CORE_PROTOCOL_V1 failures --F stage exit",
    "CORE_PROTOCOL_V1 failures --F stage exit\r\n",
    "CORE_PROTOCOL_V1 failures --F stage exit\ntrailing\n",
    "CORE_PROTOCOL_V1 failures --F stage exit\nCORE_PROTOCOL_V1 failures --F stage exit\n",
    "CORE_PROTOCOL_V1 failures --F stage " + "x".repeat(64) + "\n",
    "x".repeat(1_048_576) + "CORE_PROTOCOL_V1 failures --F stage exit\n",
  ]) {
    assert.throws(
      () => assertCoreProtocolContracts({ status: 1, signal: null, stderr }),
      (error) =>
        error instanceof assert.AssertionError &&
        error.message.includes("Core protocol: unknown") &&
        !error.message.includes("private-stage-canary") &&
        !error.stack?.includes("private-stage-canary"),
    );
  }
  let stageTraps = 0;
  assert.throws(
    () =>
      assertCoreProtocolContracts({
        status: null,
        signal: null,
        error: { code: "ENOBUFS" },
        get stderr() {
          stageTraps += 1;
          throw new Error("private-stage-canary");
        },
      }),
    { message: /Core protocol: unknown/u },
  );
  assertCoreProtocolContracts({
    status: 0,
    signal: null,
    get stderr() {
      stageTraps += 1;
      throw new Error("private-stage-canary");
    },
  });
  assert.equal(stageTraps, 0);
  const { readFile } = await import("node:fs/promises");
  /** @type {unknown} */
  const raw = JSON.parse(
    await readFile("scripts/observability-pilot/source-tests.json", "utf8"),
  );
  assert.ok(Array.isArray(raw) && raw.every((id) => typeof id === "string"));
  const first = raw[0];
  assert.ok(typeof first === "string");
  const prefix = `CORE_SOURCE_V1 start ${first}\n`;
  const full = raw
    .map((id) => `CORE_SOURCE_V1 start ${id}\nCORE_SOURCE_V1 completed ${id}\n`)
    .join("");
  const beforeRead = {
    status: null,
    signal: "SIGTERM",
    error: { code: "ENOBUFS" },
    get stderr() {
      throw new Error("private-canary");
    },
  };
  let traps = 0;
  const proxy = new Proxy(
    {},
    {
      get() {
        traps++;
        throw new Error("private-canary");
      },
      getOwnPropertyDescriptor() {
        traps++;
        throw new Error("private-canary");
      },
    },
  );
  const failures = [
    beforeRead,
    proxy,
    null,
    {},
    { status: 0, signal: null, error: proxy },
    {
      get status() {
        throw new Error("private-canary");
      },
      signal: null,
    },
    {
      status: {
        toString() {
          throw new Error("private-canary");
        },
      },
      signal: null,
    },
    {
      status: 0,
      get signal() {
        throw new Error("private-canary");
      },
    },
    {
      status: 0,
      signal: null,
      error: {
        get code() {
          throw new Error("private-canary");
        },
      },
    },
    {
      status: 0,
      signal: null,
      error: {
        code: "private-canary",
        get message() {
          throw new Error("private-canary");
        },
      },
    },
    { status: 1, signal: null, stderr: full },
    { status: null, signal: null, stderr: full },
    { status: 0, signal: "SIGTERM", stderr: full },
    {
      status: null,
      signal: "SIGTERM",
      error: { code: "ETIMEDOUT" },
      stderr: prefix + "private-canary",
    },
  ];
  for (const value of failures) {
    try {
      assertCoreContracts(value);
      assert.fail("controlled native failure hidden");
    } catch (error) {
      assert.ok(error instanceof assert.AssertionError);
      assert.ok(!error.message.includes("private-canary"));
      assert.ok(!error.stack?.includes("private-canary"));
      assert.ok(error.message.includes("Core source progress:"));
    }
  }
  const footer = "CORE_PROTOCOL_V1 failures F-E\n";
  assert.throws(
    () =>
      assertCoreProtocolContracts({
        status: 1,
        signal: null,
        stderr: footer,
      }),
    {
      message:
        /Core protocol: test_inventory_preserves_all_baseline_methods_and_exact_additions=failure; test_runner_uses_original_discovery_and_refuses_inventory_drift=error/u,
    },
  );
  for (const stderr of [
    "",
    "private-canary",
    "CORE_SOURCE_V1 start fixed\n",
    "CORE_PROTOCOL_V1 failures F-- field output\n",
    "CORE_PROTOCOL_V1 failures -E- field output\n",
    "CORE_PROTOCOL_V1 failures --- field output\n",
    "CORE_PROTOCOL_V1 failures --F field private-canary\n",
    "CORE_PROTOCOL_V1 failures --F field output field exit\n",
    "CORE_PROTOCOL_V1 failures --F field output",
    "CORE_PROTOCOL_V1 failures --F field output\nCORE_PROTOCOL_V1 failures --F\n",
    "CORE_PROTOCOL_V1 failures --F field output\r\n",
    "CORE_PROTOCOL_V1 failures --F field " + "x".repeat(64) + "\n",
    footer.slice(0, -1),
    footer + footer,
    footer + "trailing\n",
    "prefix " + footer,
    footer.replace("V1", "V2"),
    footer.replace("F-E", "---"),
    footer.replace("F-E", "FE"),
    footer.replace("F-E", "FFE-"),
    footer.replace("F-E", "F?E"),
    footer.replace("\n", "\r\n"),
    "CORE_PROTOCOL foreign\n" + footer,
    "x".repeat(1_048_576) + footer,
  ]) {
    assert.throws(
      () => assertCoreProtocolContracts({ status: 1, signal: null, stderr }),
      {
        message: /Core protocol: unknown/u,
      },
    );
  }
  for (const value of failures) {
    assert.throws(
      () => assertCoreProtocolContracts(value),
      (error) =>
        error instanceof assert.AssertionError &&
        error.message.includes("Core protocol:") &&
        !error.message.includes("private-canary") &&
        !error.stack?.includes("private-canary"),
    );
  }
  for (const value of [
    beforeRead,
    {
      status: 1,
      signal: null,
      error: { code: "ENOENT" },
      get stderr() {
        throw new Error("private-canary");
      },
    },
  ])
    assert.throws(() => assertCoreProtocolContracts(value), {
      message: /Core protocol: unknown/u,
    });
  for (const value of [
    { status: 0, signal: "SIGTERM", stderr: footer },
    { status: null, signal: null, stderr: footer },
    { status: 0, signal: null, error: { code: "ETIMEDOUT" }, stderr: footer },
  ])
    assert.throws(() => assertCoreProtocolContracts(value));
  assertCoreProtocolContracts({
    status: 0,
    signal: null,
    get stderr() {
      throw new Error("never inspect getter");
    },
  });
  for (const outcome of [
    { status: 0, signal: "SIGTERM" },
    { status: null, signal: null },
    { status: 0, signal: null, error: { code: "ETIMEDOUT" } },
    { status: 0, signal: null, error: { code: "ENOBUFS" } },
  ])
    assert.throws(() =>
      assertCoreProtocolContracts({
        ...outcome,
        stderr: "CORE_PROTOCOL_V1 failures --F field output\n",
      }),
    );
  assertCoreProtocolContracts({
    status: 0,
    signal: null,
    stderr: "CORE_PROTOCOL_V1 failures --F field output\n",
  });
  assertCoreProtocolContracts({ status: 0, signal: null, stderr: footer });
  assert.equal(traps, 0);
  for (const stderr of [
    "legacy private-canary",
    prefix + "CORE_SOURCE_bad\n",
    full,
  ]) {
    assertCoreContracts({ status: 0, signal: null, stderr });
  }
  assertCoreContracts({
    status: 0,
    signal: null,
    get stderr() {
      throw new Error("never inspect getter");
    },
  });
  assert.equal(sourceProgress(full)?.completedCount, 307);
});

test("Core passive dispatch retains exact legacy platform and flag branches", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const { assertCoreContracts } =
    await import("./observability-pilot/source-progress.mjs");
  const source = await readFile("scripts/observability-pilot.test.mjs", "utf8");
  const body = source
    .replace(/^import [^\n]+;\n/gmu, "")
    .replaceAll(/import\("[^"\n]*source-progress\.mjs"\)/gu, "importHelper()");
  for (const [platform, flag] of [
    ["darwin", undefined],
    ["darwin", "1"],
    ["linux", undefined],
    ["linux", "true"],
    ["linux", "1"],
  ]) {
    /** @type {Array<()=>unknown>} */
    const callbacks = [];
    /** @type {unknown[][]} */
    const calls = [];
    let imports = 0;
    runInNewContext(body, {
      process: { platform, env: { INSIDE_CORE_SOURCE_PROGRESS: flag } },
      assert,
      /** @param {unknown} _title @param {()=>unknown} callback */
      test: (_title, callback) => callbacks.push(callback),
      /** @param {unknown[]} args */
      spawnSync: (...args) => {
        calls.push(args);
        return { status: 0, signal: null, stderr: "private-canary" };
      },
      importHelper: async () => {
        imports++;
        return { assertCoreContracts };
      },
    });
    const callback = callbacks[0];
    assert.ok(callback !== undefined);
    await callback();
    const admitted = platform === "linux" && flag === "1";
    assert.equal(callbacks.length, 5);
    assert.equal(imports, admitted ? 1 : 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [
      "python3",
      admitted
        ? ["scripts/observability-pilot/source_runner.py"]
        : [
            "-m",
            "unittest",
            "discover",
            "-s",
            "scripts/observability-pilot",
            "-p",
            "test_*.py",
          ],
      { encoding: "utf8", timeout: 60000 },
    ]);
  }
});

// deterministic-test-allow unit-io: the existing owner reaps the separate virtual-clock Python contracts; Core discovery remains unchanged.
test("fixture polling preserves its one-second fact deadline", async () => {
  const { runOwnedProcess } =
    await import("./observability-umami/process-owner.mjs");
  const result = await runOwnedProcess("python3", [
    "-B",
    "scripts/observability-pilot/fixtures/fixture_poll_contracts.py",
  ]);
  assert.equal(result.reason, "exit");
  assert.equal(result.signal, null);
  assert.equal(result.code, 0, result.stderr);
});
