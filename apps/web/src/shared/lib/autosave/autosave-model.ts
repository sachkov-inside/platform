export type AutosaveResult = "saved" | "invalid" | "failed";

interface AutosaveInput<T> {
  readonly value: T;
  readonly key: string;
  readonly save: (value: T) => Promise<AutosaveResult>;
  readonly enabled: boolean;
}

export interface AutosaveStatus {
  readonly savedKey: string;
  readonly pending: boolean;
  readonly rejection: { key: string; result: "invalid" | "failed" } | null;
}

function blocksAutomaticSave(
  rejection: AutosaveStatus["rejection"],
  key: string,
) {
  return rejection?.result === "failed" || rejection?.key === key;
}

export function shouldScheduleAutosave(
  status: AutosaveStatus,
  key: string,
  enabled: boolean,
) {
  return (
    enabled &&
    key !== status.savedKey &&
    !status.pending &&
    !blocksAutomaticSave(status.rejection, key)
  );
}

export function createAutosaveModel<T>(
  initial: AutosaveInput<T>,
  publishStatus: (status: AutosaveStatus) => void,
) {
  let committed = initial;
  let savedKey = initial.key;
  let rejected: {
    key: string;
    value: T;
    result: "invalid" | "failed";
  } | null = null;
  let running: Promise<boolean> | null = null;
  function publish(pending: boolean) {
    publishStatus({
      savedKey,
      pending,
      rejection: rejected && {
        key: rejected.key,
        result: rejected.result,
      },
    });
  }

  async function write(input: Pick<AutosaveInput<T>, "key" | "value">) {
    let result: AutosaveResult;
    try {
      result = await committed.save(input.value);
    } catch {
      result = "failed";
    }
    if (result === "saved") {
      savedKey = input.key;
      rejected = null;
    } else if (result === "invalid" && committed.key === savedKey) {
      rejected = null;
    } else {
      rejected = { value: input.value, key: input.key, result };
    }
    return result === "saved";
  }

  async function flush(retry = false): Promise<boolean> {
    while (running) {
      if (!(await running)) return false;
    }
    if (!committed.enabled) return false;
    if (!retry && blocksAutomaticSave(rejected, committed.key)) return false;
    if (!rejected && committed.key === savedKey) return true;
    const input = rejected?.result === "failed" ? rejected : committed;
    running = write(input);
    publish(true);
    const saved = await running;
    running = null;
    publish(false);
    return saved && committed.key !== savedKey ? flush() : saved;
  }

  return {
    commit(input: AutosaveInput<T>) {
      committed = input;
      if (
        !running &&
        input.key === savedKey &&
        rejected?.result === "invalid"
      ) {
        rejected = null;
        publish(false);
      }
    },
    flush,
  };
}
