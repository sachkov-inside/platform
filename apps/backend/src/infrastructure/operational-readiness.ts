import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

import type { BackendProcess } from "../config/platform-config.js";
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
  assertAppliedMigrations,
  migrationRegistryIdentity,
} from "./postgres/migrate-to-latest.js";
import { platformMigrations } from "../migrations/index.js";

export type RuntimeProcess = BackendProcess;

const appliedMigrationRowsSchema = z.array(
  z.object({
    checksum: z.string().length(64),
    name: z.string().min(1),
    position: z.number().int().positive(),
  }).strict(),
);

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

export function platformSchemaReadiness(appliedRows: unknown): ReadinessReport["schema"] {
  const applied = appliedMigrationRowsSchema.parse(appliedRows);
  assertAppliedMigrations(applied, platformMigrations);
  if (applied.length !== platformMigrations.length) {
    throw new Error(
      `Expected ${String(platformMigrations.length)} Platform migrations, received ${String(applied.length)}`,
    );
  }
  return {
    identity: migrationRegistryIdentity(platformMigrations),
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
    await this.prisma.$queryRaw(Prisma.sql`select 1`);
    const schema = platformSchemaReadiness(
      await this.prisma.$queryRaw(Prisma.sql`
        select name, position, checksum
        from public.platform_migrations
        order by position
      `),
    );

    return {
      process,
      status: "ready",
      database: "reachable",
      release: this.runtimeIdentity,
      schema,
    };
  }
}
