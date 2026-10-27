export interface RestoreDatabase {
  name: string;
  url: string;
}
export interface RestoreArchive {
  path: string;
  sha256: string | undefined;
  bytes: number;
  listing: string;
}
export interface RestorePostgres {
  evidence: Record<string, unknown>;
  image: string;
  versions: { server: string; dump: string; restore: string };
  commands: { args: string[]; exitCode: number | string }[];
  emptyDatabase(): Promise<RestoreDatabase>;
  backup(database: RestoreDatabase): Promise<RestoreArchive>;
  restore(archive: RestoreArchive, destination: RestoreDatabase): Promise<void>;
  close(): Promise<void>;
}
export const restorePostgresImage: string;
export function createRestorePostgres(
  owner: "backend" | "telegram",
): Promise<RestorePostgres>;
export function snapshotDatabase(
  query: (sql: string) => Promise<{ rows: readonly unknown[] }>,
): Promise<{
  tables: Record<string, readonly string[]>;
  sequences: readonly unknown[];
}>;
