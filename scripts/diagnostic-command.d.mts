import type { ChildProcess } from "node:child_process";

export function commandExit(child: ChildProcess): Promise<number | null>;
