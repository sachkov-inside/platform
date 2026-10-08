export function signalProcessGroup(
  pid: number,
  signal: NodeJS.Signals | number,
  kill?: (pid: number, signal?: NodeJS.Signals | number) => unknown,
): boolean;
