import { loadRepositoryEnvironment } from "./load-repository-environment.js";

export interface ApiListenConfig {
  readonly host: string;
  readonly port: number;
}

export function readApiListenConfig(
  environment?: NodeJS.ProcessEnv,
): ApiListenConfig {
  loadRepositoryEnvironment();
  const values = environment ?? process.env;

  const port = Number(values.API_PORT ?? "3001");

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  return {
    host: values.API_HOST ?? "127.0.0.1",
    port,
  };
}
