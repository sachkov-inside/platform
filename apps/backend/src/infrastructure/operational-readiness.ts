import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";

import {
  PLATFORM_DATABASE,
  type PlatformDatabase,
} from "./postgres/index.js";

export type RuntimeProcess = "api" | "mcp";

export interface ReadinessReport {
  readonly process: RuntimeProcess;
  readonly status: "ok";
  readonly database: "reachable";
}

@Injectable()
export class OperationalReadiness {
  constructor(
    @Inject(PLATFORM_DATABASE)
    private readonly database: PlatformDatabase,
  ) {}

  async check(process: RuntimeProcess): Promise<ReadinessReport> {
    await sql`select 1`.execute(this.database);

    return {
      process,
      status: "ok",
      database: "reachable",
    };
  }
}
