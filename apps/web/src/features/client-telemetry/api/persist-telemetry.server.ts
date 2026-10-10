import "server-only";
import { readWebRuntimeConfig } from "@/shared/config/index.server";
import { writeStructuredLog } from "@/shared/lib/structured-log.server";

const TELEMETRY_FORWARD_TIMEOUT_MS = 2_000;

export function telemetryMobile(headers: Headers): boolean {
  const hint = headers.get("sec-ch-ua-mobile");
  if (hint === "?1") return true;
  if (hint === "?0") return false;
  return /Mobi/iu.test(headers.get("user-agent") ?? "");
}

/** Internal transport sends only the explicitly projected telemetry payload. */
export async function persistTelemetry(
  report: Readonly<Record<string, unknown>>,
): Promise<void> {
  try {
    const response = await fetch(
      `${readWebRuntimeConfig().backendBaseUrl}/internal/web-telemetry`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(report),
        cache: "no-store",
        signal: AbortSignal.timeout(TELEMETRY_FORWARD_TIMEOUT_MS),
      },
    );
    await response.body?.cancel();
    if (!response.ok)
      writeStructuredLog("error", "web-telemetry-unavailable", {
        kind: report["kind"],
      });
  } catch {
    // Original report is already logged; never publish dependency text or request headers.
    writeStructuredLog("error", "web-telemetry-unavailable", {
      kind: report["kind"],
    });
  }
}

export async function persistServerError(
  report: {
    readonly path: string;
    readonly digest?: string;
    readonly name: string;
    readonly message: string;
  },
  requestHeaders: NodeJS.Dict<string | string[]>,
): Promise<void> {
  const headers = new Headers();
  for (const key of ["sec-ch-ua-mobile", "user-agent"]) {
    const value = requestHeaders[key];
    headers.set(key, typeof value === "string" ? value : (value?.[0] ?? ""));
  }
  await persistTelemetry({
    kind: "error",
    source: "server",
    route: report.path,
    mobile: telemetryMobile(headers),
    digest: report.digest,
    name: report.name,
    message: report.message,
  });
}
