import type { Server } from "node:http";

/** Stop accepting requests, then release even incomplete request bodies owned by the review. */
export async function closeReviewServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
