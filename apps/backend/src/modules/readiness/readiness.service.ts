import { Inject, Injectable } from "@nestjs/common";

import {
  DATABASE_PROBE,
  type DatabaseProbe,
} from "./database-probe";

export type RuntimeProcess = "api" | "worker" | "mcp";

export interface ReadinessReport {
  readonly process: RuntimeProcess;
  readonly status: "ok";
  readonly database: "reachable";
}

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DATABASE_PROBE)
    private readonly database: DatabaseProbe,
  ) {}

  async check(process: RuntimeProcess): Promise<ReadinessReport> {
    await this.database.ping();

    return {
      process,
      status: "ok",
      database: "reachable",
    };
  }
}
