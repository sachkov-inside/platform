// @ts-check
// The supported content-only delivery from Content Studio (#1672): one entrypoint for the stand and
// production. It previews first, applies exactly the reviewed receipt, preserves the target's
// access, publication, Product membership and Task placement, and prints JSON for the caller.
import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import lockfile from "proper-lockfile";
import { z } from "zod";

import {
  standIdentity,
  withStandGateway,
} from "../../scripts/stand-gateway-session.mjs";
import { assertReceiverContract, clientContractVersion } from "./contract.mjs";
import { keychainStore, ownerSession } from "./credentials.mjs";
import {
  assertPinnedNode,
  prepareTrustedNetwork,
} from "./delivery-environment.mjs";
import { parseLocalResponse } from "./local-boundaries.mjs";
import { contentMaterials, contentTasks, loadPackage } from "./package.mjs";
import { apiPreservationState } from "./preservation-state.mjs";
import { applyPreservation, previewPreservation } from "./preservation.mjs";
import { reconcileJournal } from "./reconcile.mjs";
import { refusal, refusalCode } from "./refusal.mjs";
import {
  assertTargetEnvironment,
  authoringTarget,
  transportFor,
} from "./target.mjs";

const execute = promisify(execFile);
const platformRoot = resolve(import.meta.dirname, "../..");
const outputVersion = 1;

/**
 * @typedef {{
 *   target: import("./target.mjs").AuthoringTarget;
 *   send: import("./target.mjs").LocalTransport;
 *   accessToken: import("./target.mjs").AccessToken | undefined;
 *   connection: Record<string, unknown>;
 * }} Connection
 * @typedef {<T>(targetName: string, work: (connection: Connection) => Promise<T>) => Promise<T>} Connect
 */

/** @param {string} value */
function deliveryTarget(value) {
  const target = authoringTarget(value);
  if (
    target.id !== authoringTarget("stand").id &&
    target.id !== authoringTarget("production").id
  )
    throw refusal(
      "target_unsupported",
      `Content-only delivery supports the stand and production, not ${value}`,
    );
  return target;
}

/**
 * The real connection: the stand through a verified gateway it starts or reuses, production
 * through the owner's Keychain session on a checked network, one production command at a time.
 *
 * @param {{ ownerEmail?: string | undefined }} options
 * @returns {Connect}
 */
export function connectTarget({ ownerEmail }) {
  return async (targetName, work) => {
    const target = deliveryTarget(targetName);
    if (target.kind === "local") {
      const { email } = await standIdentity(ownerEmail);
      return withStandGateway(email, (_origin, gateway) =>
        work({
          target,
          send: transportFor(target, undefined),
          accessToken: undefined,
          connection: {
            gateway: {
              pid: gateway.identity.pid,
              owner: gateway.identity.owner,
              started: gateway.started,
            },
          },
        }),
      );
    }
    const resolved = await prepareTrustedNetwork([
      new URL(target.id).hostname,
      new URL(target.issuer).hostname,
    ]);
    // Logto rotates the refresh token on each renewal; two processes would revoke each other's session.
    const directory = join(homedir(), ".inside-authoring");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    /** @type {() => Promise<void>} */
    let unlock;
    try {
      unlock = await lockfile.lock(directory, {
        lockfilePath: join(directory, `${target.name}-session.lock`),
        retries: 0,
        stale: 120_000,
        update: 10_000,
      });
    } catch (error) {
      throw refusal(
        "target_busy",
        `Another ${target.name} delivery is running on this machine; wait for it and repeat`,
        error,
      );
    }
    try {
      const accessToken = ownerSession(target, { store: keychainStore() });
      try {
        await accessToken();
      } catch (error) {
        throw refusal(
          "owner_session",
          error instanceof Error ? error.message : String(error),
          error,
        );
      }
      return await work({
        target,
        send: transportFor(target, accessToken),
        accessToken,
        connection: { network: resolved },
      });
    } finally {
      await unlock();
    }
  };
}

/** @param {Connection} connection @param {{ requiredFeatures?: string[] | undefined }} manifest */
async function checkReceiver({ target, send }, manifest) {
  const environment = parseLocalResponse(
    "/authoring/import/materials/environment",
    await send("/authoring/import/materials/environment"),
  );
  assertTargetEnvironment(target, environment.mode);
  return {
    target: target.id,
    environment: environment.mode,
    contract: assertReceiverContract(environment, manifest),
  };
}

async function platformRevision() {
  try {
    const [{ stdout: head }, { stdout: status }] = await Promise.all([
      execute("git", ["-C", platformRoot, "rev-parse", "HEAD"]),
      execute("git", [
        "-C",
        platformRoot,
        "status",
        "--porcelain",
        "--untracked-files=no",
      ]),
    ]);
    return { revision: head.trim(), modified: status.trim() !== "" };
  } catch {
    return { revision: null, modified: null };
  }
}

/** @param {string[]} values */
const sorted = (values) => [...new Set(values)].sort();

/**
 * @param {{
 *   packagePath: string;
 *   stateDirectory: string;
 *   target: string;
 *   sourceCommit: string;
 *   contentRepository?: string | undefined;
 *   materialIds: string[];
 *   taskIds: string[];
 *   connect: Connect;
 * }} options
 */
export async function deliveryPreview({
  packagePath,
  stateDirectory,
  target,
  sourceCommit,
  contentRepository,
  materialIds,
  taskIds,
  connect,
}) {
  deliveryTarget(target);
  const pkg = await loadPackage(packagePath);
  const bounded = pkg.manifest.selection.contentOnly;
  if (bounded === undefined)
    throw refusal(
      "package_not_bounded",
      "The package has no selection.contentOnly; creation, archive and Product changes use pnpm authoring:release",
    );
  if (
    canonicalIds(bounded.materialIds) !== canonicalIds(materialIds) ||
    canonicalIds(bounded.taskIds) !== canonicalIds(taskIds)
  )
    throw refusal(
      "selection_mismatch",
      `The package selects Materials [${bounded.materialIds.join(", ")}] and Tasks [${bounded.taskIds.join(", ")}]; the command named [${materialIds.join(", ")}] and [${taskIds.join(", ")}]`,
    );
  return connect(target, async (connection) => {
    const receiver = await checkReceiver(connection, pkg.manifest);
    const readState = apiPreservationState(
      connection.send,
      pkg.manifest.sourceNamespace,
    );
    const result = await previewPreservation(packagePath, stateDirectory, {
      sourceCommit,
      readState,
      request: connection.send,
      target: connection.target.id,
      accessToken: connection.accessToken,
      contentRepository,
    });
    const { receipt, preview } = result;
    const key = (/** @type {string} */ id) =>
      `${pkg.manifest.sourceNamespace}:${id}`;
    const rows = [
      ...preview.preview.materials.map((row) => {
        const sourceId = String(row["sourceId"]);
        const state = receipt.state.materials.find(
          (item) => item.sourceId === key(sourceId),
        );
        return {
          kind: "material",
          sourceId,
          id: state?.materialId ?? null,
          change: row.change,
          contentVersion: state?.contentVersion ?? null,
          access: state?.access ?? null,
          publicationState: state?.publicationState ?? null,
          sourceCommit: {
            target: state?.sourceCommit ?? null,
            relation: receipt.relations[key(sourceId)] ?? null,
          },
        };
      }),
      ...(preview.preview.tasks ?? []).map((row) => {
        const sourceId = String(row["sourceId"]);
        const state = receipt.state.tasks.find(
          (item) => item.sourceId === key(sourceId),
        );
        return {
          kind: "task",
          sourceId,
          id: state?.taskId ?? null,
          change: row.change,
          revision: state?.revision ?? null,
          access: state?.access ?? null,
          publicationState: state?.publicationState ?? null,
          sourceCommit: {
            target: state?.sourceCommit ?? null,
            relation: receipt.relations[key(sourceId)] ?? null,
          },
        };
      }),
    ];
    return {
      command: "preview",
      receiver,
      connection: connection.connection,
      sourceCommit,
      package: {
        path: receipt.originalPackagePath,
        id: receipt.originalPackageId,
      },
      derivedPackage: { path: receipt.packagePath, id: receipt.packageId },
      selection: {
        materialIds: contentMaterials(pkg.manifest).map((row) => row.sourceId),
        taskIds: contentTasks(pkg.manifest).map((row) => row.sourceId),
      },
      receipt: result.path,
      preview: { path: preview.path, fingerprint: preview.preview.fingerprint },
      rows,
      hasChanges: rows.some((row) => row.change !== "unchanged"),
    };
  });
}

/** @param {string[]} values */
const canonicalIds = (values) => JSON.stringify(sorted(values));

/**
 * @param {{ receiptPath: string; stateDirectory: string; connect: Connect }} options
 */
export async function deliveryApply({ receiptPath, stateDirectory, connect }) {
  const envelope = z
    .object({
      target: z.string(),
      packagePath: z.string(),
      previewPath: z.string(),
    })
    .passthrough()
    .parse(JSON.parse(await readFile(receiptPath, "utf8")));
  deliveryTarget(envelope.target);
  const pkg = await loadPackage(envelope.packagePath);
  return connect(envelope.target, async (connection) => {
    const receiver = await checkReceiver(connection, pkg.manifest);
    const { path, proof } = await applyPreservation(
      receiptPath,
      stateDirectory,
      {
        readState: apiPreservationState(
          connection.send,
          pkg.manifest.sourceNamespace,
        ),
        request: connection.send,
        accessToken: connection.accessToken,
      },
    );
    const rows = [
      ...proof.before.materials.map((before) => {
        const after = proof.after.materials.find(
          (row) => row.sourceId === before.sourceId,
        );
        return {
          kind: "material",
          sourceId: before.sourceId,
          id: before.materialId,
          contentVersion: {
            before: before.contentVersion,
            after: after?.contentVersion ?? null,
          },
          sourceCommit: {
            before: before.sourceCommit ?? null,
            after: after?.sourceCommit ?? null,
          },
        };
      }),
      ...proof.before.tasks.map((before) => {
        const after = proof.after.tasks.find(
          (row) => row.sourceId === before.sourceId,
        );
        return {
          kind: "task",
          sourceId: before.sourceId,
          id: before.taskId,
          revision: { before: before.revision, after: after?.revision ?? null },
          sourceCommit: {
            before: before.sourceCommit ?? null,
            after: after?.sourceCommit ?? null,
          },
        };
      }),
    ];
    return {
      command: "apply",
      receiver,
      connection: connection.connection,
      sourceCommit: proof.sourceCommit,
      receipt: resolve(receiptPath),
      proof: path,
      applied: proof.report.applied,
      unchanged: proof.report.unchanged,
      rows,
      verification: { preserved: true, ...proof.verification },
    };
  });
}

/**
 * @param {{ stateDirectory: string; target: string; namespace: string; adopt: string[]; connect: Connect }} options
 */
export async function deliveryReconcile({
  stateDirectory,
  target,
  namespace,
  adopt,
  connect,
}) {
  deliveryTarget(target);
  return connect(target, async (connection) => {
    const receiver = await checkReceiver(connection, {});
    const report = await reconcileJournal(stateDirectory, {
      target: connection.target,
      send: connection.send,
      namespace,
      adopt,
    });
    return { command: "reconcile", receiver, ...report };
  });
}

const usage = `Usage:
  pnpm --silent authoring:deliver preview --target stand|production --package PACKAGE_JSON --commit CONTENT_SHA --content-repository CONTENT_REPOSITORY --state STATE_DIRECTORY [--material SOURCE_ID]... [--task SOURCE_ID]... [--owner-email STAND_OWNER_EMAIL]
  pnpm --silent authoring:deliver apply --receipt RECEIPT_JSON --state STATE_DIRECTORY [--owner-email STAND_OWNER_EMAIL]
  pnpm --silent authoring:deliver reconcile --target stand|production --state STATE_DIRECTORY --namespace SOURCE_NAMESPACE [--adopt SOURCE_ID]... [--owner-email STAND_OWNER_EMAIL]`;

/**
 * Runs one command and returns its JSON document and exit code; never throws.
 *
 * @param {string[]} argv
 * @param {{ connect?: Connect; nodeVersion?: string }} [dependencies]
 */
export async function runDelivery(argv, dependencies = {}) {
  /** @type {string | undefined} */
  let command;
  try {
    const { positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        target: { type: "string" },
        package: { type: "string" },
        commit: { type: "string" },
        "content-repository": { type: "string" },
        state: { type: "string" },
        material: { type: "string", multiple: true, default: [] },
        task: { type: "string", multiple: true, default: [] },
        receipt: { type: "string" },
        namespace: { type: "string" },
        adopt: { type: "string", multiple: true, default: [] },
        "owner-email": { type: "string" },
      },
    });
    command = positionals[0];
    assertPinnedNode(dependencies.nodeVersion);
    const connect =
      dependencies.connect ??
      connectTarget({ ownerEmail: values["owner-email"] });
    /** @type {Record<string, unknown>} */
    let result;
    if (
      command === "preview" &&
      positionals.length === 1 &&
      values.target &&
      values.package &&
      values.commit &&
      values["content-repository"] &&
      values.state
    )
      result = await deliveryPreview({
        packagePath: values.package,
        stateDirectory: values.state,
        target: values.target,
        sourceCommit: values.commit,
        contentRepository: values["content-repository"],
        materialIds: values.material,
        taskIds: values.task,
        connect,
      });
    else if (
      command === "apply" &&
      positionals.length === 1 &&
      values.receipt &&
      values.state &&
      values.target === undefined
    )
      result = await deliveryApply({
        receiptPath: values.receipt,
        stateDirectory: values.state,
        connect,
      });
    else if (
      command === "reconcile" &&
      positionals.length === 1 &&
      values.target &&
      values.state &&
      values.namespace
    )
      result = await deliveryReconcile({
        stateDirectory: values.state,
        target: values.target,
        namespace: values.namespace,
        adopt: values.adopt,
        connect,
      });
    else throw refusal("usage", usage);
    return {
      exitCode: 0,
      document: {
        schemaVersion: outputVersion,
        ok: true,
        platform: {
          ...(await platformRevision()),
          contractVersion: clientContractVersion,
          node: process.versions.node,
        },
        ...result,
      },
    };
  } catch (error) {
    const code =
      error instanceof TypeError &&
      "code" in error &&
      String(error.code).startsWith("ERR_PARSE_ARGS")
        ? "usage"
        : refusalCode(error);
    return {
      exitCode: code === "usage" ? 2 : 1,
      document: {
        schemaVersion: outputVersion,
        ok: false,
        command: command ?? null,
        error: {
          code,
          message: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { exitCode, document } = await runDelivery(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
  process.exitCode = exitCode;
}
