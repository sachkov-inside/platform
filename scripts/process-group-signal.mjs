import process from "node:process";

export function signalProcessGroup(pid, signal, kill = process.kill) {
  try {
    kill(-pid, signal);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      Reflect.has(error, "code") &&
      (error.code === "EPERM" || error.code === "ESRCH")
    ) {
      return false;
    }
    throw error;
  }
}
