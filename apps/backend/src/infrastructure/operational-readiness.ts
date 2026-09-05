import { Inject, Injectable } from "@nestjs/common";

import type { BackendProcess } from "../config/platform-config.js";
import { platformMigrations } from "../migrations/index.js";
import {
  expectedPgBossSchemaVersion,
  runtimeDatabaseSchemaIdentity,
} from "../migrations/runtime-schema.js";
import {
  RUNTIME_IDENTITY,
  type RuntimeIdentity,
} from "./runtime-identity.js";
import {
  Prisma,
  PrismaClientProvider,
  type PlatformPrisma,
} from "./prisma/index.js";
import {
  type MigrationVerification,
  assertAppliedMigrations,
  parseAppliedMigrations,
  parsePgBossSchemaVersionRows,
} from "./postgres/migrate-to-latest.js";

export type RuntimeProcess = BackendProcess;

export interface LivenessReport {
  readonly process: RuntimeProcess;
  readonly release: RuntimeIdentity;
  readonly status: "alive";
}

export interface ReadinessReport {
  readonly process: RuntimeProcess;
  readonly status: "ready";
  readonly database: "reachable";
  readonly release: RuntimeIdentity;
  readonly schema: {
    readonly identity: string;
    readonly migrationCount: number;
  };
}

export function runtimeSchemaReadiness(
  migrationState: MigrationVerification,
): ReadinessReport["schema"] {
  if (migrationState.appliedMigrations.length !== platformMigrations.length) {
    throw new Error(
      `Expected ${String(platformMigrations.length)} Platform migrations, received ${String(migrationState.appliedMigrations.length)}`,
    );
  }
  const { jobSchemaVersion } = migrationState;
  if (jobSchemaVersion !== expectedPgBossSchemaVersion) {
    throw new Error(
      `Expected PgBoss schema ${String(expectedPgBossSchemaVersion)}, received ${String(jobSchemaVersion)}`,
    );
  }
  return {
    identity: runtimeDatabaseSchemaIdentity(
      platformMigrations,
      jobSchemaVersion,
    ),
    migrationCount: platformMigrations.length,
  };
}

@Injectable()
export class OperationalReadiness {
  constructor(
    @Inject(PrismaClientProvider)
    private readonly prisma: Pick<PlatformPrisma, "$queryRaw">,
    @Inject(RUNTIME_IDENTITY)
    private readonly runtimeIdentity: RuntimeIdentity,
  ) {}

  live(process: RuntimeProcess): LivenessReport {
    return {
      process,
      release: this.runtimeIdentity,
      status: "alive",
    };
  }

  async check(process: RuntimeProcess): Promise<ReadinessReport> {
    const applied = parseAppliedMigrations(
      await this.prisma.$queryRaw(Prisma.sql`
        select name, position, checksum
        from public.platform_migrations
        order by position
      `),
    );
    assertAppliedMigrations(applied, platformMigrations);
    const jobSchemaVersion = parsePgBossSchemaVersionRows(
      await this.prisma.$queryRaw(Prisma.sql`select version from pgboss.version`),
    );
    const schema = runtimeSchemaReadiness({
      appliedMigrations: applied.map(({ name }) => name),
      jobSchemaVersion,
    });

    return {
      process,
      status: "ready",
      database: "reachable",
      release: this.runtimeIdentity,
      schema,
    };
  }
}
