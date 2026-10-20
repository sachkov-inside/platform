import { z } from "zod";

const unavailable = "S3 API diagnostic unavailable";
const privacyFailure = "S3 API privacy validation failed";
const exportsSchema = z.array(z.string().max(1_048_576)).max(32);
const secretsSchema = z.array(z.string().min(1).max(2048)).max(64);
const valueSchema = z.union([
  z.object({ stringValue: z.string().max(256) }).strict(),
  z
    .object({
      intValue: z.union([z.number().int(), z.string().max(64)]),
    })
    .strict(),
  z.object({}).strict(),
]);
const spansSchema = z
  .array(
    z
      .object({
        traceId: z.string().regex(/^[0-9a-f]{32}$/),
        spanId: z.string().regex(/^[0-9a-f]{16}$/),
        parentSpanId: z
          .string()
          .regex(/^[0-9a-f]{16}$/)
          .optional(),
        kind: z.number().int().min(1).max(5),
        name: z.string().max(256),
        attributes: z
          .array(
            z.object({ key: z.string().max(64), value: valueSchema }).strict(),
          )
          .max(16),
      })
      .strict(),
  )
  .max(512);
type Span = z.infer<typeof spansSchema>[number];
const operations = [
  "getObject.read",
  "http.GET",
  "http.PUT",
  "http.DELETE",
] as const;
const statuses = [
  "200",
  "301",
  "307",
  "403",
  "404",
  "429",
  "500",
  "503",
] as const;
const allowedS3Attributes = new Set([
  "dependency.name",
  "dependency.operation",
  "dependency.outcome",
  "http.request.method",
  "http.response.status_code",
]);

type PrivacyReason =
  | "capture_shape"
  | "corpus_shape"
  | "document_count"
  | "document_bytes"
  | "total_bytes"
  | "node_budget"
  | "depth_budget"
  | "malformed_json"
  | "private_match"
  | "signing_match";
type PrivacyPhase = "input" | "raw" | "token" | "decoded";

/** Validate the entire bounded capture before parsing assertions or diagnostic output. */
export function assertPrivateS3Exports(
  exports: unknown,
  privateValues: readonly string[],
  emit?: (event: string) => void,
): void {
  let reason: PrivacyReason = "capture_shape";
  let phase: PrivacyPhase = "input";
  let documentsCount = 0;
  let corpusEntries = 0;
  let total = 0;
  let nodes = 0;
  let maximumDepth = 0;
  const refuse: (failure: PrivacyReason) => never = (failure) => {
    reason = failure;
    throw new Error();
  };
  try {
    const documents = exportsSchema.safeParse(exports);
    const secrets = secretsSchema.safeParse(privateValues);
    // Read counts only from parsed copies or the schema's known saturation boundary,
    // never re-read arbitrary input getters just to construct a refusal diagnostic.
    documentsCount = documents.success ? documents.data.length : 0;
    corpusEntries = secrets.success ? secrets.data.length : 0;
    if (
      !secrets.success &&
      secrets.error.issues.some(
        (issue) => issue.code === "too_big" && issue.origin === "array",
      )
    )
      corpusEntries = 65;
    if (!documents.success) {
      const first = documents.error.issues[0];
      if (first?.code === "too_big") {
        if (first.origin === "array") documentsCount = 33;
        refuse(first.origin === "array" ? "document_count" : "document_bytes");
      }
      refuse("capture_shape");
    }
    if (!secrets.success) refuse("corpus_shape");
    const inspect = (value: unknown, depth: number): void => {
      nodes++;
      maximumDepth = Math.max(maximumDepth, depth);
      if (nodes > 100_000) refuse("node_budget");
      if (depth > 32) refuse("depth_budget");
      if (typeof value === "string") {
        if (secrets.data.some((secret) => value.includes(secret)))
          refuse("private_match");
        if (/X-Amz-|AWS4-HMAC-SHA256|Credential=|Signature=/i.test(value))
          refuse("signing_match");
      } else if (Array.isArray(value)) {
        if (value.length > 100_000) refuse("node_budget");
        for (const item of value) inspect(item, depth + 1);
      } else if (value !== null && typeof value === "object") {
        const entries = Object.entries(value);
        if (entries.length > 100_000) refuse("node_budget");
        for (const [key, item] of entries) {
          inspect(key, depth + 1);
          inspect(item, depth + 1);
        }
      }
    };
    for (const raw of documents.data) {
      phase = "raw";
      const bytes = Buffer.byteLength(raw);
      total += bytes;
      if (bytes > 1_048_576) refuse("document_bytes");
      if (total > 4_194_304) refuse("total_bytes");
      if (secrets.data.some((secret) => raw.includes(secret)))
        refuse("private_match");
      if (/X-Amz-|AWS4-HMAC-SHA256|Credential=|Signature=/i.test(raw))
        refuse("signing_match");
      // Inspect every decoded string before object construction can discard an
      // earlier duplicate member. This is a privacy scan, not a JSON parser:
      // JSON.parse below still validates the complete document syntax.
      phase = "token";
      reason = "malformed_json";
      let depth = 0;
      for (let cursor = 0; cursor < raw.length; cursor++) {
        const character = raw[cursor];
        if (character === '"') {
          let end = cursor + 1;
          for (; end < raw.length; end++) {
            if (raw[end] === "\\") end++;
            else if (raw[end] === '"') break;
          }
          if (end >= raw.length) refuse("malformed_json");
          const token: unknown = JSON.parse(raw.slice(cursor, end + 1));
          inspect(token, 0);
          cursor = end;
        } else if (character === "{" || character === "[") {
          depth++;
          maximumDepth = Math.max(maximumDepth, depth);
          if (depth > 32) refuse("depth_budget");
        } else if (character === "}" || character === "]") {
          depth--;
          if (depth < 0) refuse("malformed_json");
        }
      }
      // Never expose JSON parser excerpts, even for malformed private input.
      phase = "decoded";
      reason = "malformed_json";
      const decoded: unknown = JSON.parse(raw);
      inspect(decoded, 0);
    }
  } catch {
    // Only owned enums and saturating progress counters may cross this diagnostic boundary.
    // An unavailable diagnostic sink must never replace the original constant refusal.
    try {
      const event = JSON.stringify({
        event: "s3_api_privacy_guard",
        reason,
        phase,
        documents: documentsCount,
        totalBytes: Math.min(total, 4_194_305),
        nodes: Math.min(nodes, 100_001),
        depth: Math.min(maximumDepth, 33),
        corpusEntries,
      });
      if (Buffer.byteLength(event) <= 512) emit?.(event);
    } catch {
      /* The diagnostic is optional; the privacy refusal remains authoritative. */
    }
    throw new Error(privacyFailure);
  }
}

function attribute(span: Span, key: string): string | number | undefined {
  const value = span.attributes.find((entry) => entry.key === key)?.value;
  return value === undefined
    ? undefined
    : "stringValue" in value
      ? value.stringValue
      : "intValue" in value
        ? value.intValue
        : undefined;
}
function operation(span: Span) {
  const value = attribute(span, "dependency.operation");
  return operations.find((candidate) => candidate === value) ?? "other";
}

/** Return fixed enums/counts only; malformed or oversized inputs have one constant fallback. */
export function summarizeS3Attempts(input: unknown): string {
  try {
    if (!Array.isArray(input) || input.length > 512) return unavailable;
    const rows: readonly unknown[] = input;
    for (const span of rows) {
      if (
        span !== null &&
        typeof span === "object" &&
        "attributes" in span &&
        Array.isArray(span.attributes) &&
        span.attributes.length > 16
      )
        return unavailable;
    }
    const parsed = spansSchema.safeParse(input);
    if (!parsed.success) return unavailable;
    for (const span of parsed.data) {
      if (
        new Set(span.attributes.map((entry) => entry.key)).size !==
        span.attributes.length
      )
        return unavailable;
      if (
        attribute(span, "dependency.name") === "s3" &&
        span.attributes.some((entry) => !allowedS3Attributes.has(entry.key))
      )
        return unavailable;
    }
    const counts = new Map<
      string,
      {
        operation: string;
        outcome: string;
        status: string;
        parentRole: string;
        count: number;
      }
    >();
    for (const span of parsed.data) {
      if (attribute(span, "dependency.name") !== "s3") continue;
      const outcome = attribute(span, "dependency.outcome");
      const code = attribute(span, "http.response.status_code");
      const parents = parsed.data.filter(
        (candidate) =>
          candidate.traceId === span.traceId &&
          candidate.spanId === span.parentSpanId,
      );
      const parent = parents.length === 1 ? parents[0] : undefined;
      const parentOperation =
        parent === undefined ? undefined : operation(parent);
      const parentRole =
        parent === undefined
          ? "other"
          : attribute(parent, "dependency.name") === "s3" &&
              parentOperation === "getObject.read" &&
              parent.kind === 1
            ? "read"
            : attribute(parent, "dependency.name") === "s3" &&
                parentOperation?.startsWith("http.") === true &&
                parent.kind === 3
              ? "http"
              : parent.kind === 2 &&
                  attribute(parent, "dependency.name") !== "s3"
                ? "server"
                : "other";
      const cell = {
        operation: operation(span),
        outcome:
          outcome === "completed" || outcome === "failed" ? outcome : "other",
        status: !span.attributes.some(
          (entry) => entry.key === "http.response.status_code",
        )
          ? "none"
          : (statuses.find((candidate) => candidate === String(code)) ??
            "other"),
        parentRole,
      };
      const key = JSON.stringify(cell);
      const previous = counts.get(key);
      counts.set(key, { ...cell, count: (previous?.count ?? 0) + 1 });
      if (counts.size > 32) return unavailable;
    }
    const summary = JSON.stringify(
      [...counts.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, cell]) => cell),
    );
    return summary.length <= 8192 ? summary : unavailable;
  } catch {
    return unavailable;
  }
}
