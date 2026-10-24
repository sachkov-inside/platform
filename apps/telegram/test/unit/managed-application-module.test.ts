import { expect, it } from "vitest";
import {
  TELEGRAM_OBSERVABILITY,
  disabledTelegramObservability,
} from "../../src/observability/telegram-observability.js";
import { AppModule } from "../../src/app.module.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
import { createDatabase } from "../../src/database/create-database.js";
import { DATABASE } from "../../src/database/database.js";
import { DatabaseLifecycle } from "../../src/database/database-lifecycle.js";
import { DatabaseInitialization } from "../../src/database/database-initialization.js";

it("managed composition installs one supplied database and no independent destroy owner", async () => {
  const config = loadApplicationConfig({
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
    TELEGRAM_BOT_IDENTITY: "synthetic",
    TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_00000000",
    PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_0000000",
    WORKERS_ENABLED: "false",
    TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
    TELEGRAM_LINK_RECEIPT_TEXT: "Synthetic receipt",
    TELEGRAM_LINKED_MEMBER_TEXT: "Synthetic member",
    TELEGRAM_LINKED_NON_MEMBER_TEXT: "Synthetic nonmember",
    TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Synthetic unavailable",
    TELEGRAM_WELCOME_TEXT: "Synthetic welcome",
  });
  // Lazy pool acquisition is local; this provider-graph contract never connects to PostgreSQL.
  const database = createDatabase(config.databaseUrl);
  try {
    const providers =
      AppModule.registerManaged(config, database, disabledTelegramObservability)
        .providers ?? [];
    expect(
      providers.filter(
        (provider) =>
          "provide" in provider && provider.provide === TELEGRAM_OBSERVABILITY,
      ),
    ).toEqual([
      {
        provide: TELEGRAM_OBSERVABILITY,
        useValue: disabledTelegramObservability,
      },
    ]);
    expect(
      providers.filter((provider) => provider === DatabaseLifecycle),
    ).toHaveLength(0);
    expect(
      providers.filter((provider) => provider === DatabaseInitialization),
    ).toHaveLength(1);
    const bindings = providers.filter(
      (provider) => "provide" in provider && provider.provide === DATABASE,
    );
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toEqual({ provide: DATABASE, useValue: database });
    expect("onApplicationShutdown" in DatabaseInitialization.prototype).toBe(
      false,
    );
    const raw = AppModule.register(config).providers ?? [];
    expect(raw).toContain(DatabaseLifecycle);
    expect(raw).not.toContain(DatabaseInitialization);
  } finally {
    await database.destroy();
  }
});
