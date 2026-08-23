import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    postgresAdminUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer("postgres:18.4-alpine").start();
  project.provide("postgresAdminUrl", container.getConnectionUri());

  return async () => {
    await container.stop();
  };
}
