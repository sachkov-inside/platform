import { spawnSync } from "node:child_process";
import process from "node:process";

const runtimeNames = new Set([
  "BACKEND_BASE_URL",
  "LOGTO_ENDPOINT",
  "LOGTO_AUDIENCE",
  "LOGTO_APP_ID",
  "LOGTO_APP_SECRET",
  "LOGTO_COOKIE_SECRET",
  "WEB_BASE_URL",
]);
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !runtimeNames.has(name)),
);
Object.assign(environment, {
  HOSTNAME: "127.0.0.1",
  NODE_ENV: "production",
  PORT: "0",
});

const result = spawnSync(
  process.execPath,
  [".next/standalone/apps/web/server.js"],
  {
    encoding: "utf8",
    env: environment,
    timeout: 10_000,
  },
);
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

if (result.error !== undefined) {
  throw result.error;
}
if (result.status !== 1) {
  throw new Error(
    `Standalone server did not exit with status 1 for incomplete production config\n${output}`,
  );
}
if (
  !output.includes(
    "Web startup failed: BACKEND_BASE_URL is required in production mode",
  )
) {
  throw new Error(
    `Standalone server exited without the configuration diagnostic\n${output}`,
  );
}

process.stdout.write(
  "Standalone server rejected incomplete production config before readiness.\n",
);
