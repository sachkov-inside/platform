import { createServer } from "node:http";
import { buffer } from "node:stream/consumers";

import type { TbankConfig } from "../../config/tbank-config.js";
import { createLocalBankDouble } from "./local-bank-double.js";

interface Options {
  readonly config: TbankConfig;
  readonly host: string;
  readonly port: number;
}

export interface RunningBankDouble {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Сетевая оболочка двойника: она переводит запрос Node в стандартный `Request` и обратно, а всё
 * поведение банка остаётся в одном месте и потому проверяется без сокета.
 */
export async function startLocalBankDouble(options: Options): Promise<RunningBankDouble> {
  const double = createLocalBankDouble({ config: options.config });
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const body = await buffer(incoming);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (typeof value === "string") headers.set(name, value);
      const request = new Request(new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "127.0.0.1"}`), {
        method: incoming.method ?? "GET", headers,
        ...(incoming.method === "GET" || incoming.method === "HEAD" ? {} : { body }),
      });
      const response = await double.handle(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch((error: unknown) => {
      console.error(JSON.stringify({ process: "bank-double", failed: incoming.url, reason: String(error) }));
      if (!outgoing.headersSent) outgoing.writeHead(400, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ Success: false, ErrorCode: "9999" }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });
  const address = server.address();
  return {
    port: typeof address === "object" && address !== null ? address.port : options.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => { if (error) reject(error); else resolve(); });
      server.closeAllConnections();
    }),
  };
}
