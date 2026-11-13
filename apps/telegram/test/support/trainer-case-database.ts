import { sql } from "kysely";

import { createFixtureDatabase } from "./fixture-database.js";

interface TrainerCaseWork {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
  pending?: Promise<unknown>;
  cancellation?: Promise<unknown>;
}

/** Owns the complete asynchronous body of one Trainer case before the next reset. */
export function createTrainerCaseDatabase(
  databaseUrl: string,
  applicationName: string,
) {
  let active: TrainerCaseWork | undefined;
  const database = createFixtureDatabase(
    databaseUrl,
    applicationName,
    () => active?.signal.aborted === true,
  ).withPlugin({
    transformQuery({ node }) {
      // Cancellation also stops a body that resumes between two SQL operations.
      active?.signal.throwIfAborted();
      return node;
    },
    async transformResult({ result }) {
      return result;
    },
  });
  const owner = createFixtureDatabase(
    databaseUrl,
    `${applicationName}_cleanup`,
  );

  async function finish(): Promise<void> {
    const owned = active;
    if (!owned) return;
    try {
      await owned.cancellation;
    } finally {
      await Promise.allSettled(owned.pending ? [owned.pending] : []);
      owned.signal.removeEventListener("abort", owned.cancel);
      active = undefined;
    }
  }
  return {
    database,
    run<Result>(
      signal: AbortSignal,
      work: () => Promise<Result>,
    ): Promise<Result> {
      if (active) throw new Error("Finish the previous Trainer case first");
      signal.throwIfAborted();
      const cancel = () => {
        owned.cancellation ??= sql`select pg_terminate_backend(pid)
          from pg_stat_activity where application_name = ${applicationName}
            and state <> 'idle'
            and pid <> pg_backend_pid()`.execute(owner);
        // The hook joins cancellation; an event listener cannot await it.
        void owned.cancellation.catch(() => undefined);
      };
      const owned: TrainerCaseWork = { signal, cancel };
      active = owned;
      signal.addEventListener("abort", cancel, { once: true });
      const result = Promise.resolve().then(work);
      owned.pending = result;
      void result.catch(() => undefined);
      return result;
    },
    finish,
    async destroy(): Promise<void> {
      try {
        await finish();
      } finally {
        try {
          await database.destroy();
        } finally {
          await owner.destroy();
        }
      }
    },
  };
}
