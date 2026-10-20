export interface DiagnosticError {
  readonly name: string;
  readonly message: string;
  readonly digest?: string;
}

const errorNames = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "AbortError",
  "TimeoutError",
]);

/** Client messages can contain any entered text; digest and technical type retain correlation. */
export function diagnosticError(
  input: {
    readonly name: string;
    readonly message: string;
    readonly digest?: string | undefined;
  },
  source: "client" | "server",
): DiagnosticError {
  const digest = diagnosticDigest(input.digest);
  return {
    name: errorNames.has(input.name) ? input.name : "Error",
    ...(digest === undefined ? {} : { digest }),
    message:
      source === "client"
        ? "[client-error-text-omitted]"
        : /^(?:Prisma|DriverAdapter|SyntaxError$|ZodError$)/u.test(input.name)
          ? "[redacted-input-error]"
          : diagnosticText(input.message),
  };
}

/** Retain bounded numeric/hex digests; arbitrary client labels can contain personal data. */
function diagnosticDigest(
  value: string | undefined,
): string | undefined {
  return value !== undefined && /^(?:\d{1,10}|[a-f\d]{32,64})$/iu.test(value)
    ? value
    : undefined;
}

/** Diagnostic text is untrusted: exceptions can include contacts and credentials. */
export function diagnosticText(text: string, limit = 500): string {
  const redacted = text
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/giu, "[redacted-url]")
    .replace(/\beyJ[\w-]*\.[\w-]*\.[\w-]*/gu, "[redacted-jwt]")
    .replace(/\b(bearer|basic)\s+[\w.~+/=-]+/giu, "$1 [redacted]")
    .replace(
      /\b(password|passwd|secret|token|api[-_]?key|access[-_]?key|signature|authorization|cookie|code)(["']?\s*[:=]\s*)["']?[^\s"',;&]+/giu,
      "$1$2[redacted]",
    )
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, "[redacted-email]")
    .replace(/\+?\d(?:[\s()-]?\d){9,}/gu, "[redacted-number]");
  return Array.from(redacted).slice(0, limit).join("");
}
