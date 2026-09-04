export interface ProcessShutdownSignal {
  readonly received: Promise<void>;
  dispose(): void;
}

export function listenForProcessShutdown(): ProcessShutdownSignal {
  let resolveSignal: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  const dispose = (): void => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const onSignal = (): void => {
    dispose();
    resolveSignal?.();
  };

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  return { received, dispose };
}
