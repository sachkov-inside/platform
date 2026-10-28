import { Inject, Injectable } from "@nestjs/common";

import type { BackendProcess } from "../config/platform-config.js";
import { platformMigrations } from "../migrations/index.js";
import {
  runtimeSchemaReadiness,
  type RuntimeSchemaReadiness,
} from "../migrations/runtime-schema.js";
import { RUNTIME_IDENTITY, type RuntimeIdentity } from "./runtime-identity.js";
import {
  Prisma,
  PrismaClientProvider,
  type PlatformPrisma,
} from "./prisma/index.js";
import {
  assertAppliedMigrations,
  parseAppliedMigrations,
  parsePgBossSchemaVersionRows,
} from "./postgres/migrate-to-latest.js";

export { runtimeSchemaReadiness } from "../migrations/runtime-schema.js";

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
  readonly schema: RuntimeSchemaReadiness;
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
      await this.prisma.$queryRaw(
        Prisma.sql`select version from pgboss.version`,
      ),
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
