import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  Ajv2020,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { z } from "zod";

const contractRoot = fileURLToPath(
  new URL("../../../contracts/workshop/", import.meta.url),
);

const schemaFiles = {
  "assignment-manifest": "inside.workshop.assignment-manifest.v1.schema.json",
  "case-spec": "inside.workshop.case-spec.v1.schema.json",
  "evaluation-report": "inside.workshop.evaluation-report.v1.schema.json",
  "source-snapshot": "inside.workshop.source-snapshot.v1.schema.json",
} as const;
const primitivesSchemaFile = "inside.workshop.primitives.v1.schema.json";

type ContractKind = keyof typeof schemaFiles;

type CorpusCase = {
  name: string;
  target: ContractKind;
  document: string;
  caseSpec?: string;
  assignmentManifest?: string;
  valid: boolean;
  expectedCode?: string;
  trailingWhitespaceBytes?: number;
};

type ValidationResult =
  | { valid: true }
  | { valid: false; code: string };

type ContractValidator = {
  validate: ValidateFunction;
  byteLimits: Record<string, number>;
  diagnosticMessages: Record<string, string>;
};

type LoadedContractSchema = {
  schema: Record<string, unknown>;
  byteLimits: Record<string, number>;
  diagnosticMessages: Record<string, string>;
};

type CorpusDocument = {
  value: unknown;
  bytes: number;
};

export async function runWorkshopContractCorpus(
  root = contractRoot,
): Promise<void> {
  const validators = await compileSchemas(root);
  const index = await readJson(path.join(root, "conformance/index.json"));
  const cases = corpusCases(index);
  const failures: string[] = [];

  for (const corpusCase of cases) {
    const result = await validateCorpusCase(root, validators, corpusCase);
    const matches = corpusCase.valid
      ? result.valid
      : !result.valid && result.code === corpusCase.expectedCode;
    if (!matches) {
      failures.push(
        `${corpusCase.name}: expected ${expectedResult(corpusCase)}, got ${actualResult(result)}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`Workshop contract conformance failed:\n${failures.join("\n")}`);
  }
}

async function compileSchemas(
  root: string,
): Promise<Record<ContractKind, ContractValidator>> {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormatsModule.default(ajv);
  ajv.addKeyword({ keyword: "x-inside-byte-limits", schemaType: "object" });
  ajv.addKeyword({
    keyword: "x-inside-diagnostic-messages",
    schemaType: "object",
  });
  const primitivesSchema = asRecord(
    await readJson(path.join(root, primitivesSchemaFile)),
  );
  if (primitivesSchema === undefined) {
    throw new TypeError(`${primitivesSchemaFile} must contain a JSON object schema`);
  }
  ajv.addSchema(primitivesSchema);
  const loaded = {
    "assignment-manifest": await loadSchema(root, "assignment-manifest"),
    "case-spec": await loadSchema(root, "case-spec"),
    "evaluation-report": await loadSchema(root, "evaluation-report"),
    "source-snapshot": await loadSchema(root, "source-snapshot"),
  } satisfies Record<ContractKind, LoadedContractSchema>;
  for (const contract of Object.values(loaded)) {
    ajv.addSchema(contract.schema);
  }
  return {
    "assignment-manifest": compiledValidator(ajv, loaded["assignment-manifest"]),
    "case-spec": compiledValidator(ajv, loaded["case-spec"]),
    "evaluation-report": compiledValidator(ajv, loaded["evaluation-report"]),
    "source-snapshot": compiledValidator(ajv, loaded["source-snapshot"]),
  };
}

async function loadSchema(
  root: string,
  kind: ContractKind,
): Promise<LoadedContractSchema> {
  const filename = schemaFiles[kind];
  const schema = asRecord(await readJson(path.join(root, filename)));
  if (schema === undefined) {
    throw new TypeError(`${filename} must contain a JSON object schema`);
  }
  return {
    schema,
    byteLimits: byteLimits(schema, filename),
    diagnosticMessages: stringMapAnnotation(
      schema,
      "x-inside-diagnostic-messages",
      filename,
    ),
  };
}

function compiledValidator(
  ajv: Ajv2020,
  loaded: LoadedContractSchema,
): ContractValidator {
  const schemaId = stringField(loaded.schema, "$id");
  const validate = ajv.getSchema(schemaId);
  if (validate === undefined) {
    throw new TypeError(`schema was not registered: ${schemaId}`);
  }
  return {
    validate,
    byteLimits: loaded.byteLimits,
    diagnosticMessages: loaded.diagnosticMessages,
  };
}

async function validateCorpusCase(
  root: string,
  validators: Record<ContractKind, ContractValidator>,
  corpusCase: CorpusCase,
): Promise<ValidationResult> {
  const document = await readCorpusDocument(
    root,
    corpusCase.document,
    corpusCase.trailingWhitespaceBytes,
  );
  const schemaResult = validateSchema(
    validators[corpusCase.target].validate,
    document.value,
  );
  if (!schemaResult.valid) return schemaResult;

  if (corpusCase.target === "case-spec") {
    if (hasDuplicateScenarioIds(document.value)) {
      return { valid: false, code: "schema_invalid" };
    }
    return document.bytes <=
      requiredByteLimit(validators["case-spec"].byteLimits, "document")
      ? { valid: true }
      : { valid: false, code: "case_spec_oversize" };
  }
  if (corpusCase.target === "source-snapshot") return { valid: true };

  const caseSpec = await requiredContextDocument(
    root,
    corpusCase.caseSpec,
    "caseSpec",
  );
  const caseSchema = validateSchema(validators["case-spec"].validate, caseSpec);
  if (!caseSchema.valid) return { valid: false, code: "context_invalid" };

  if (corpusCase.target === "assignment-manifest") {
    if (hasDuplicateScenarioIds(document.value)) {
      return { valid: false, code: "schema_invalid" };
    }
    return validateManifestBindings(caseSpec, document.value);
  }

  const manifest = await requiredContextDocument(
    root,
    corpusCase.assignmentManifest,
    "assignmentManifest",
  );
  const manifestSchema = validateSchema(
    validators["assignment-manifest"].validate,
    manifest,
  );
  if (!manifestSchema.valid) return { valid: false, code: "context_invalid" };
  const manifestBindings = validateManifestBindings(caseSpec, manifest);
  if (!manifestBindings.valid) return { valid: false, code: "context_invalid" };

  return validateReportBindings(
    caseSpec,
    manifest,
    document.value,
    document.bytes,
    validators["evaluation-report"].byteLimits,
    validators["evaluation-report"].diagnosticMessages,
  );
}

function validateManifestBindings(
  caseSpecValue: unknown,
  manifestValue: unknown,
): ValidationResult {
  const caseSpec = asRecord(caseSpecValue);
  const manifest = asRecord(manifestValue);
  if (caseSpec === undefined || manifest === undefined) {
    return { valid: false, code: "context_invalid" };
  }

  if (
    stringField(manifest, "caseId") !== stringField(caseSpec, "caseId") ||
    stringField(manifest, "caseVersion") !== stringField(caseSpec, "caseVersion") ||
    stringField(manifest, "evaluatorVersion") !== stringField(caseSpec, "evaluatorVersion")
  ) {
    return { valid: false, code: "incompatible_version" };
  }

  const variantId = stringField(manifest, "variantId");
  const variant = arrayField(caseSpec, "variants")
    .map(asRecord)
    .find((candidate) => candidate !== undefined && stringField(candidate, "id") === variantId);
  if (variant === undefined) return { valid: false, code: "binding_mismatch" };

  const evaluatorBundle = asRecord(manifest.evaluatorBundle);
  if (
    stringField(manifest, "starterArtifactSha256") !==
      stringField(variant, "starterArtifactSha256") ||
    evaluatorBundle === undefined ||
    stringField(evaluatorBundle, "sha256") !==
      stringField(variant, "evaluatorBundleSha256")
  ) {
    return { valid: false, code: "binding_mismatch" };
  }

  const caseScenarios = scenarioRequirements(caseSpec);
  const manifestScenarios = scenarioRequirements(manifest);
  if (!sameRequirements(caseScenarios, manifestScenarios)) {
    return { valid: false, code: "binding_mismatch" };
  }
  if (!sameValues(supportedHosts(caseSpec), supportedHosts(manifest))) {
    return { valid: false, code: "binding_mismatch" };
  }

  return { valid: true };
}

function validateReportBindings(
  caseSpecValue: unknown,
  manifestValue: unknown,
  reportValue: unknown,
  reportBytes: number,
  limits: Record<string, number>,
  diagnosticMessages: Record<string, string>,
): ValidationResult {
  const caseSpec = asRecord(caseSpecValue);
  const manifest = asRecord(manifestValue);
  const report = asRecord(reportValue);
  if (caseSpec === undefined || manifest === undefined || report === undefined) {
    return { valid: false, code: "context_invalid" };
  }

  if (reportBytes > requiredByteLimit(limits, "document")) {
    return { valid: false, code: "report_oversize" };
  }

  for (const key of ["caseVersion", "evaluatorVersion"] as const) {
    if (
      stringField(report, key) !== stringField(manifest, key) ||
      stringField(report, key) !== stringField(caseSpec, key)
    ) {
      return { valid: false, code: "incompatible_version" };
    }
  }
  for (const key of ["assignmentId", "caseId", "variantId"] as const) {
    if (stringField(report, key) !== stringField(manifest, key)) {
      return { valid: false, code: "binding_mismatch" };
    }
  }

  const declared = scenarioRequirements(caseSpec);
  const environment = asRecord(report.environment);
  const reportHost =
    environment === undefined
      ? ""
      : `${stringField(environment, "os")}/${stringField(environment, "arch")}`;
  if (!supportedHosts(caseSpec).has(reportHost)) {
    return { valid: false, code: "schema_invalid" };
  }
  const seen = new Set<string>();
  let diagnosticBytes = 0;
  for (const scenarioValue of arrayField(report, "scenarios")) {
    const scenario = asRecord(scenarioValue);
    if (scenario === undefined) return { valid: false, code: "schema_invalid" };
    const id = stringField(scenario, "id");
    if (seen.has(id)) return { valid: false, code: "duplicate_scenario" };
    seen.add(id);
    if (!declared.has(id)) return { valid: false, code: "unknown_scenario" };

    const diagnostic = asRecord(scenario.diagnostic);
    if (diagnostic !== undefined) {
      const message = stringField(diagnostic, "message");
      const messageBytes = Buffer.byteLength(message, "utf8");
      if (messageBytes > requiredByteLimit(limits, "diagnosticMessage")) {
        return { valid: false, code: "diagnostics_oversize" };
      }
      diagnosticBytes += messageBytes;
      const code = stringField(diagnostic, "code");
      if (diagnosticMessages[code] !== message) {
        return { valid: false, code: "schema_invalid" };
      }
    }
  }
  if (diagnosticBytes > requiredByteLimit(limits, "diagnosticsTotal")) {
    return { valid: false, code: "diagnostics_oversize" };
  }
  for (const [id, required] of declared) {
    if (required && !seen.has(id)) {
      return { valid: false, code: "missing_required_scenario" };
    }
  }

  const startedAt = Date.parse(stringField(report, "startedAt"));
  const finishedAt = Date.parse(stringField(report, "finishedAt"));
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || startedAt > finishedAt) {
    return { valid: false, code: "invalid_time_range" };
  }
  return { valid: true };
}

function validateSchema(
  validator: ValidateFunction,
  document: unknown,
): ValidationResult {
  return validator(document)
    ? { valid: true }
    : { valid: false, code: "schema_invalid" };
}

function scenarioRequirements(value: Record<string, unknown>): Map<string, boolean> {
  const requirements = new Map<string, boolean>();
  for (const scenarioValue of arrayField(value, "scenarios")) {
    const scenario = asRecord(scenarioValue);
    if (scenario === undefined) continue;
    requirements.set(stringField(scenario, "id"), scenario.required === true);
  }
  return requirements;
}

function hasDuplicateScenarioIds(value: unknown): boolean {
  const document = asRecord(value);
  if (document === undefined) return false;
  const seen = new Set<string>();
  for (const scenarioValue of arrayField(document, "scenarios")) {
    const scenario = asRecord(scenarioValue);
    if (scenario === undefined) continue;
    const id = stringField(scenario, "id");
    if (seen.has(id)) return true;
    seen.add(id);
  }
  return false;
}

function sameRequirements(
  left: Map<string, boolean>,
  right: Map<string, boolean>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [id, required] of left) {
    if (right.get(id) !== required) return false;
  }
  return true;
}

function sameValues(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function supportedHosts(caseSpec: Record<string, unknown>): Set<string> {
  const result = new Set<string>();
  for (const hostValue of arrayField(caseSpec, "supportedHosts")) {
    const host = asRecord(hostValue);
    if (host !== undefined) {
      result.add(`${stringField(host, "os")}/${stringField(host, "arch")}`);
    }
  }
  return result;
}

function corpusCases(value: unknown): CorpusCase[] {
  const root = asRecord(value);
  const cases = root === undefined ? undefined : root.cases;
  if (!Array.isArray(cases)) throw new TypeError("conformance index must contain cases");
  return cases.map((candidate) => {
    const record = asRecord(candidate);
    if (
      record === undefined ||
      typeof record.name !== "string" ||
      !isContractKind(record.target) ||
      typeof record.document !== "string" ||
      typeof record.valid !== "boolean"
    ) {
      throw new TypeError("invalid conformance case");
    }
    if (!record.valid && typeof record.expectedCode !== "string") {
      throw new TypeError(`${record.name}: invalid cases require expectedCode`);
    }
    if (
      record.trailingWhitespaceBytes !== undefined &&
      (typeof record.trailingWhitespaceBytes !== "number" ||
        !Number.isSafeInteger(record.trailingWhitespaceBytes) ||
        record.trailingWhitespaceBytes <= 0)
    ) {
      throw new TypeError(`${record.name}: invalid trailingWhitespaceBytes`);
    }
    return {
      name: record.name,
      target: record.target,
      document: record.document,
      valid: record.valid,
      ...(typeof record.caseSpec === "string" ? { caseSpec: record.caseSpec } : {}),
      ...(typeof record.assignmentManifest === "string"
        ? { assignmentManifest: record.assignmentManifest }
        : {}),
      ...(typeof record.expectedCode === "string"
        ? { expectedCode: record.expectedCode }
        : {}),
      ...(typeof record.trailingWhitespaceBytes === "number" &&
      Number.isSafeInteger(record.trailingWhitespaceBytes) &&
      record.trailingWhitespaceBytes > 0
        ? { trailingWhitespaceBytes: record.trailingWhitespaceBytes }
        : {}),
    };
  });
}

function isContractKind(value: unknown): value is ContractKind {
  return typeof value === "string" && Object.hasOwn(schemaFiles, value);
}

async function requiredContextDocument(
  root: string,
  relativePath: string | undefined,
  field: string,
): Promise<unknown> {
  if (relativePath === undefined) throw new TypeError(`missing ${field} context`);
  return (await readCorpusDocument(root, relativePath)).value;
}

async function readCorpusDocument(
  root: string,
  relativePath: string,
  trailingWhitespaceBytes = 0,
): Promise<CorpusDocument> {
  const corpusRoot = path.resolve(root, "conformance");
  const resolved = path.resolve(corpusRoot, relativePath);
  if (!resolved.startsWith(`${corpusRoot}${path.sep}`)) {
    throw new TypeError(`conformance path escapes corpus: ${relativePath}`);
  }
  const contents = await readFile(resolved);
  const padded =
    trailingWhitespaceBytes === 0
      ? contents
      : Buffer.concat([contents, Buffer.alloc(trailingWhitespaceBytes, " ")]);
  return {
    value: JSON.parse(padded.toString("utf8")) as unknown,
    bytes: padded.byteLength,
  };
}

async function readJson(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(filename, "utf8")) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === "string" ? field : "";
}

function arrayField(value: Record<string, unknown>, key: string): unknown[] {
  const field = value[key];
  return Array.isArray(field) ? field : [];
}

function byteLimits(
  schema: Record<string, unknown>,
  filename: string,
): Record<string, number> {
  const limits = asRecord(schema["x-inside-byte-limits"]);
  if (limits === undefined) return {};
  const result: Record<string, number> = {};
  for (const [name, value] of Object.entries(limits)) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${filename}: invalid byte limit ${name}`);
    }
    result[name] = value;
  }
  return result;
}

function stringMapAnnotation(
  schema: Record<string, unknown>,
  name: string,
  filename: string,
): Record<string, string> {
  const annotation = asRecord(schema[name]);
  if (annotation === undefined) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(annotation)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`${filename}: invalid ${name}.${key}`);
    }
    result[key] = value;
  }
  return result;
}

function requiredByteLimit(
  limits: Record<string, number>,
  name: string,
): number {
  const value = limits[name];
  if (value === undefined) throw new TypeError(`missing byte limit ${name}`);
  return value;
}

function expectedResult(corpusCase: CorpusCase): string {
  return corpusCase.valid ? "valid" : `invalid(${corpusCase.expectedCode})`;
}

function actualResult(result: ValidationResult): string {
  return result.valid ? "valid" : `invalid(${result.code})`;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await runWorkshopContractCorpus();
  process.stdout.write("TypeScript Workshop contract conformance passed.\n");
}
