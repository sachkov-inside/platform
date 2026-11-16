import { z } from "zod";
import { localTbankConfig } from "../config/tbank-config.js";
import { startLocalBankDouble } from "./bank-double/start-local-bank-double.js";
import { startIsolatedTelegramProvider } from "./start-isolated-telegram-provider.js";

async function main(): Promise<void> {
  if (process.env["NODE_ENV"] !== "development")
    throw new Error("Isolated commerce providers require NODE_ENV=development");
  const database = new URL(
    z.url().parse(process.env["DATABASE_URL"]),
  ).pathname.slice(1);
  if (!/^inside_light_[a-f0-9]{10}$/u.test(database))
    throw new Error("Commerce providers require an isolated light database");
  if (
    process.env["TBANK_PROVIDER_MODE"] !== "test" ||
    process.env["TBANK_CONFIG_JSON"] !== undefined
  )
    throw new Error("Commerce providers require the local test bank only");
  const bankConfig = localTbankConfig(process.env);
  for (const url of [
    bankConfig.endpoints.apiBaseUrl,
    ...bankConfig.endpoints.formOrigins,
    bankConfig.notificationUrl,
    bankConfig.returnUrl,
  ]) {
    const address = new URL(url);
    if (address.protocol !== "http:" || address.hostname !== "127.0.0.1")
      throw new Error("Commerce providers require owned loopback addresses");
  }
  const telegramPort = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(process.env["ISOLATED_TELEGRAM_PORT"]);
  const bankPort = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(new URL(bankConfig.endpoints.apiBaseUrl).port);
  const closers: (() => Promise<void>)[] = [];
  async function close(): Promise<void> {
    const results = await Promise.allSettled(closers.map((stop) => stop()));
    if (results.some((result) => result.status === "rejected"))
      throw new Error("An isolated commerce provider could not stop");
  }
  try {
    const telegram = await startIsolatedTelegramProvider({
      databaseName: database,
      port: telegramPort,
    });
    closers.push(() => telegram.close());
    const bank = await startLocalBankDouble({
      config: bankConfig,
      host: "127.0.0.1",
      port: bankPort,
    });
    closers.push(() => bank.close());
    process.stdout.write(
      `${JSON.stringify({ process: "isolated-commerce-providers", status: "ready", bankPort, telegramPort })}\n`,
    );
  } catch (error) {
    await close();
    throw error;
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void close().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error(error);
          process.exit(1);
        },
      );
    });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
