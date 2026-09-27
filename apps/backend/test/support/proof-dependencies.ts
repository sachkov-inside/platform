// Types for repository proof scripts that load backend test dependencies through createRequire. A
// type import from a relative path into node_modules cannot resolve these packages' own imports.
export { Client } from "pg";
export {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
