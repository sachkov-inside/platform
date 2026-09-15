// Двойник backend для доказательств #562: отвечает только на GET /library/home.
// Закреп переключается запросом POST /__pin/<none|ai-first>; DOUBLE_DELAY_MS задерживает ответ главной.
import { createServer } from "node:http";

const port = Number(process.env.DOUBLE_PORT ?? "3389");
const delayMs = Number(process.env.DOUBLE_DELAY_MS ?? "0");
const aiFirstSlug = process.env.AI_FIRST_SLUG ?? "working-with-agents";
let pin = "none";

const aiFirst = {
  count: 6,
  cover: null,
  id: "5d6c1b0e-6f7a-4b6f-9c3e-1a2b3c4d5e6f",
  name: "AI-first разработка",
  previewItems: [],
  slug: aiFirstSlug,
  summary: "Практикум с моим сопровождением: инженерная работа с агентами от задачи до релиза.",
};

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://double");
  if (request.method === "POST" && url.pathname.startsWith("/__pin/")) {
    pin = url.pathname.slice("/__pin/".length);
    response.writeHead(204).end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/library/home") {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        pinnedSeries: pin === "ai-first" ? aiFirst : null,
        guides: [], notes: [], videos: [], playlists: [], topics: [],
        membership: { kind: "notOffered" },
      }));
    }, delayMs);
    return;
  }
  response.writeHead(404, { "content-type": "application/problem+json" });
  response.end(JSON.stringify({ status: 404, title: "Not Found" }));
}).listen(port, "127.0.0.1");
