import { Inject, Injectable } from "@nestjs/common";

import {
  Prisma,
  PrismaClientProvider,
} from "./prisma/index.js";

export type RuntimeProcess = "api" | "mcp";

export interface ReadinessReport {
  readonly process: RuntimeProcess;
  readonly status: "ok";
  readonly database: "reachable";
}

@Injectable()
export class OperationalReadiness {
  constructor(
    @Inject(PrismaClientProvider)
    private readonly prisma: PrismaClientProvider,
  ) {}

  async check(process: RuntimeProcess): Promise<ReadinessReport> {
    await this.prisma.$queryRaw(Prisma.sql`select 1`);

    return {
      process,
      status: "ok",
      database: "reachable",
    };
  }
}
