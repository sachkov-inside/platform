import { loadRepositoryEnvironment } from "./load-repository-environment.js";

const DEFAULT_DATABASE_URL =
  "postgresql://inside:inside@127.0.0.1:5432/inside";

export interface DatabaseConfig {
  readonly url: string;
}

export function readDatabaseConfig(
  environment?: NodeJS.ProcessEnv,
): DatabaseConfig {
  loadRepositoryEnvironment();
  const values = environment ?? process.env;

  return {
    url: values.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  };
}
