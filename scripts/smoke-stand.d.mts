import type { ChildProcess } from "node:child_process";

export const reservedPortRange: { first: number; last: number };
export function createPortAllocator(
  canBind?: (port: number) => Promise<boolean>,
): (pick?: () => number) => Promise<number>;
export const reservePort: ReturnType<typeof createPortAllocator>;
export function stopProcessGroup(child: ChildProcess): Promise<void>;
export function stopServerOnPort(
  child: ChildProcess,
  port: number,
): Promise<void>;
export function startWithRoutes<Server>(options: {
  baseUrl: string;
  routes: readonly string[];
  start: () => Server;
  stop: (server: Server) => Promise<void>;
  ready: (server: Server) => Promise<unknown>;
  request?: (url: string) => Promise<{ status: number }>;
  log?: (message: string) => void;
}): Promise<Server>;
