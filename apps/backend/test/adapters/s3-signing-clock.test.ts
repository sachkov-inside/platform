import { once } from "node:events";
import { createServer } from "node:http";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, test, vi } from "vitest";

const providerDate = Date;

// deterministic-test-allow unit-io: pinned S3 signing/retry uses an owned ephemeral HTTP receiver; no external storage or database. Clients, sockets and virtual Date close in finally.
// deterministic-test-allow wall-clock: the receiver keeps the original provider Date while only the skewed client uses a virtual Date; the real-clock control proves transport authentication rather than a domain calendar rule.
test.each([
  { label: "virtual client Date", skew: true, statuses: [403, 200] },
  { label: "provider wall clock", skew: false, statuses: [200] },
])(
  "cold S3 signing with $label records every actual attempt",
  async ({ skew, statuses }) => {
    const observed: number[] = [];
    let malformed = false;
    const server = createServer((request, response) => {
      request.resume();
      const header = request.headers["x-amz-date"];
      const match =
        typeof header === "string"
          ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u.exec(header)
          : null;
      if (match === null) {
        malformed = true;
        response.writeHead(400).end();
        return;
      }
      const signedAt = providerDate.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6]),
      );
      const now = providerDate.now();
      response.setHeader("date", new providerDate(now).toUTCString());
      if (Math.abs(signedAt - now) > 300_000) {
        observed.push(403);
        response
          .writeHead(403, { "content-type": "application/xml" })
          .end(
            `<Error><Code>RequestTimeTooSkewed</Code><Message>Owned clock contract</Message><ServerTime>${new providerDate(now).toISOString()}</ServerTime></Error>`,
          );
      } else {
        observed.push(200);
        response
          .writeHead(200, { "content-type": "application/octet-stream" })
          .end("clock-proof");
      }
    });
    let client: S3Client | undefined;
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Owned signing receiver unavailable");
      if (skew) {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(providerDate.now() - 86_400_000);
      }
      client = new S3Client({
        endpoint: `http://127.0.0.1:${address.port}`,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: {
          accessKeyId: "owned-clock-access",
          secretAccessKey: "owned-clock-secret",
        },
        maxAttempts: 2,
        requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 },
      });
      const result = await client.send(
        new GetObjectCommand({ Bucket: "clock-proof", Key: "object" }),
      );
      if (result.Body === undefined)
        throw new Error("Owned signing body unavailable");
      expect(
        Buffer.from(await result.Body.transformToByteArray()).toString("utf8"),
      ).toBe("clock-proof");
      expect(malformed).toBe(false);
      expect(observed).toEqual(statuses);
    } finally {
      client?.destroy();
      vi.useRealTimers();
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          ),
        );
    }
  },
);
