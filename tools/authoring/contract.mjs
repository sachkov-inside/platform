// @ts-check
// The import contract handshake (#1672). Before the first write the client compares its contract
// version and the package's required features with what the receiver reports in `environment`.
import { authoringImportContract } from "../../apps/backend/src/modules/materials/domain/authoring-import-contract.ts";
import { supportedPackageFeatures } from "./package.mjs";
import { refusal } from "./refusal.mjs";

/** The receiver contract this client speaks: environment contract, state reads and `source.commit`. */
export const clientContractVersion = authoringImportContract.version;

/**
 * The receiver's contract, refused when it is missing, another version, or lacks a package feature.
 *
 * @param {import("./local-boundaries.mjs").LocalResponse<"/authoring/import/materials/environment">} environment
 * @param {{ requiredFeatures?: string[] | undefined }} manifest
 */
export function assertReceiverContract(environment, manifest) {
  const { contract } = environment;
  if (contract === undefined)
    throw refusal(
      "receiver_contract_missing",
      "The receiver predates the import contract (#1672); deploy a Platform revision that reports it before delivering",
    );
  if (contract.version !== clientContractVersion)
    throw refusal(
      "receiver_contract_mismatch",
      `The receiver speaks import contract ${String(contract.version)}; this client speaks ${String(clientContractVersion)}. Use a Platform checkout of the receiver's revision`,
    );
  const missing = (manifest.requiredFeatures ?? []).filter(
    (feature) =>
      !contract.packageFeatures.includes(feature) ||
      !supportedPackageFeatures.includes(feature),
  );
  if (missing.length > 0)
    throw refusal(
      "package_feature_unsupported",
      `The receiver or this client does not support package features: ${missing.join(", ")}`,
    );
  return contract;
}
