export function validateLocalAccountsSettings(input: unknown): {
  mode: "development";
  endpoint: string;
  audience: string;
  webBaseUrl: string;
};
export function startLocalAccountsGateway(options: {
  port: number;
  listenHost?: "127.0.0.1" | "0.0.0.0";
  upstream: string;
  cookieName: string;
  secret: string;
  createSession: (choice: string) => Promise<string>;
}): Promise<{ origin: string; close: () => Promise<void> }>;
