// Types for repository proof scripts that load backend dependencies dynamically. A
// type import from a relative path into node_modules cannot resolve these packages' own imports.
export { Client } from "pg";
export {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

export type { NestApplicationOptions } from "@nestjs/common";
export type { NestFastifyApplication } from "@nestjs/platform-fastify";
