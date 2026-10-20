import type { TechnicalTelemetry } from "../../infrastructure/observability/technical-telemetry.js";

/** The API owns both delivery pumps and closes their shared SDK after draining both owners. */
export async function shutdownApiDeliveryTelemetry(
  pumps: readonly [
    { onApplicationShutdown(): Promise<void> },
    { onApplicationShutdown(): Promise<void> },
  ],
  telemetry: Pick<TechnicalTelemetry, "shutdown">,
): Promise<void> {
  const drained = await Promise.allSettled(
    pumps.map(async (pump) => pump.onApplicationShutdown()),
  );
  const failures: unknown[] = [];
  for (const result of drained) {
    if (result.status === "rejected") failures.push(result.reason);
  }
  try {
    await telemetry.shutdown();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      "API-owned delivery telemetry failed to close",
    );
}
