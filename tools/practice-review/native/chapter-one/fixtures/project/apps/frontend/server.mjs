import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const server = createServer((request, response) => {
  void (async () => {
    if (request.url === "/api/health") {
      const backend = await fetch(`${process.env.BACKEND_URL}/health`);
      response.writeHead(backend.status, {
        "content-type": "application/json",
      });
      response.end(await backend.text());
    } else if (request.url === "/vue.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(await readFile("node_modules/vue/dist/vue.global.prod.js"));
    } else {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await readFile("apps/frontend/index.html"));
    }
  })().catch(() => {
    response.writeHead(503).end("Unavailable");
  });
});
server.listen(8080, "0.0.0.0");
process.once("SIGTERM", () => server.close());
