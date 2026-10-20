import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { DATABASE, type Database } from "./database.js";
import { migrateToLatest } from "./migrator.js";

/** Managed production initializes schema; the application lifetime alone destroys the pool. */
@Injectable()
export class DatabaseInitialization implements OnModuleInit {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async onModuleInit(): Promise<void> {
    await migrateToLatest(this.database);
  }
}
