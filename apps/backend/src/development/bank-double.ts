import { loadPlatformConfig } from "../config/load-platform-config.js";
import { parsePlatformMode } from "../config/platform-config.js";
import { startLocalBankDouble } from "./bank-double/start-local-bank-double.js";

const DEFAULT_BANK_DOUBLE_HOST = "127.0.0.1";

async function main(): Promise<void> {
  // Режим проверяется до остальной конфигурации: отказ двойника не должен зависеть от того,
  // какие боевые значения оказались рядом.
  if (parsePlatformMode(process.env.NODE_ENV) !== "development") {
    throw new Error("The local bank double runs only with NODE_ENV=development");
  }
  const config = loadPlatformConfig();
  if (config.tbank?.environment !== "local") {
    throw new Error("The local bank double requires TBANK_PROVIDER_MODE=test");
  }
  const endpoint = new URL(config.tbank.endpoints.apiBaseUrl);
  const running = await startLocalBankDouble({
    config: config.tbank,
    host: process.env.BANK_DOUBLE_HOST?.trim() || DEFAULT_BANK_DOUBLE_HOST,
    port: Number(endpoint.port || "80"),
  });
  process.stdout.write(`${JSON.stringify({ process: "bank-double", status: "ready", port: running.port })}\n`);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => void running.close().then(() => process.exit(0)));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
