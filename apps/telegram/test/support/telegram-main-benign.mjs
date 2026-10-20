// @ts-check
// Benign harness fixture, never application/native-service evidence.
import { createServer } from "node:net";
const server = createServer();
process.on("SIGTERM", () => server.close());
server.listen(0, "127.0.0.1", () =>
  process.stdout.write("owned benign child ready\n"),
);
