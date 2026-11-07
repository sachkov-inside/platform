// PROTOTYPE, throwaway (#1984). Check 4: the turn belongs to the server, not to the HTTP request.
// - POST /api/message starts a turn and returns at once; the turn runs to the end without any client.
// - Every UI chunk is written to turn_event with a sequence number, then pushed to live subscribers
//   from process memory (no Redis).
// - GET /api/events?after=N (SSE) replays rows after N from the table, then streams live ones.
// - POST /api/stop aborts the model call; the partial answer is kept with status "stopped".
// - On start, a turn left "running" by a killed process becomes "interrupted".
// Run: node src/turn-server.ts  then open http://localhost:4984 in two tabs.
import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { streamText, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { pool } from "./db.ts";

const CONVERSATION = "account-1"; // one conversation per Account; the session would supply it.

await pool.query(`
  CREATE TABLE IF NOT EXISTS turn (
    id bigserial PRIMARY KEY, conversation_id text NOT NULL, question text NOT NULL,
    status text NOT NULL, answer text NOT NULL DEFAULT '', started_at timestamptz NOT NULL DEFAULT now());
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_turn ON turn (conversation_id) WHERE status = 'running';
  CREATE TABLE IF NOT EXISTS turn_event (
    seq bigserial PRIMARY KEY, conversation_id text NOT NULL, turn_id bigint NOT NULL,
    chunk jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
`);

const subscribers = new Map<string, Set<ServerResponse>>();
const running = new Map<string, AbortController>();

async function emit(conversationId: string, turnId: number, chunk: unknown) {
  const { rows } = await pool.query(
    "INSERT INTO turn_event (conversation_id, turn_id, chunk) VALUES ($1,$2,$3) RETURNING seq",
    [conversationId, turnId, JSON.stringify(chunk)],
  );
  const line = `id: ${rows[0].seq}\ndata: ${JSON.stringify({ seq: Number(rows[0].seq), turnId, chunk })}\n\n`;
  for (const res of subscribers.get(conversationId) ?? []) res.write(line);
}

// Interrupted by a restart: no process owns these turns any more.
for (const row of (await pool.query("UPDATE turn SET status = 'interrupted' WHERE status = 'running' RETURNING id, conversation_id")).rows)
  await emit(row.conversation_id, Number(row.id), { type: "turn-status", status: "interrupted" });

function slowModel(question: string) {
  const words = `Ответ на «${question}». `.concat(
    "Это заглушка модели: она пишет по одному слову раз в 150 мс, чтобы было время перезагрузить вкладку, открыть вторую и нажать «Остановить». ".repeat(3),
  ).split(/(?<= )/);
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: simulateReadableStream({
        chunkDelayInMs: 150,
        chunks: [
          { type: "text-start", id: "t" },
          ...words.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
          { type: "text-end", id: "t" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: words.length, text: words.length, reasoning: 0 } },
          },
        ],
        _internal: { delay: (ms) => new Promise((r, j) => { const t = setTimeout(r, ms ?? 0); abortSignal?.addEventListener("abort", () => { clearTimeout(t); j(abortSignal.reason); }); }) },
      }),
    }),
  });
}

// One active turn per conversation is guarded by the partial unique index, not by process memory:
// two fast POSTs both passed an in-memory check in the first run of this prototype.
async function createTurn(conversationId: string, question: string): Promise<number | null> {
  try {
    const { rows } = await pool.query(
      "INSERT INTO turn (conversation_id, question, status) VALUES ($1,$2,'running') RETURNING id",
      [conversationId, question],
    );
    return Number(rows[0].id);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }
}

async function runTurn(conversationId: string, turnId: number, question: string) {
  const controller = new AbortController();
  running.set(conversationId, controller);
  await emit(conversationId, turnId, { type: "turn-status", status: "running", question });
  let answer = "";
  let status = "done";
  try {
    const result = streamText({ model: slowModel(question), prompt: question, abortSignal: controller.signal });
    for await (const chunk of result.toUIMessageStream()) {
      if (chunk.type === "text-delta") answer += chunk.delta;
      await emit(conversationId, turnId, chunk);
      if (chunk.type === "abort") status = "stopped";
    }
  } catch (error) {
    status = controller.signal.aborted ? "stopped" : "failed";
  }
  await pool.query("UPDATE turn SET status = $2, answer = $3 WHERE id = $1", [turnId, status, answer]);
  running.delete(conversationId);
  await emit(conversationId, turnId, { type: "turn-status", status });
}

async function body(req: import("node:http").IncomingMessage) {
  let data = "";
  for await (const part of req) data += part;
  return data ? JSON.parse(data) : {};
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.end(readFileSync(new URL("./turn-page.html", import.meta.url)));
  }
  if (url.pathname === "/api/message" && req.method === "POST") {
    const { text } = await body(req);
    const turnId = await createTurn(CONVERSATION, text);
    if (turnId === null) return res.writeHead(409).end("turn already running");
    void runTurn(CONVERSATION, turnId, text); // not awaited: the request ends, the turn goes on
    return res.writeHead(202).end();
  }
  if (url.pathname === "/api/stop" && req.method === "POST") {
    running.get(CONVERSATION)?.abort("stopped by user");
    return res.writeHead(204).end();
  }
  if (url.pathname === "/api/history") {
    const { rows } = await pool.query("SELECT id, question, status, answer FROM turn WHERE conversation_id = $1 AND status <> 'running' ORDER BY id", [CONVERSATION]);
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify(rows));
  }
  if (url.pathname === "/api/events") {
    // The client names the last seq it has; EventSource also sends Last-Event-ID on reconnect.
    // A reload sends after=-1: "replay the active turn from its start".
    let after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    // Subscribe first and hold live lines, so nothing falls between the replay and the live stream.
    const held: string[] = [];
    const live = { write: (line: string) => (held.push(line), true) } as unknown as ServerResponse;
    const set = subscribers.get(CONVERSATION) ?? new Set();
    subscribers.set(CONVERSATION, set);
    set.add(live);
    if (after < 0) {
      const active = await pool.query("SELECT coalesce(min(e.seq) - 1, 0) AS from FROM turn t JOIN turn_event e ON e.turn_id = t.id WHERE t.conversation_id = $1 AND t.status = 'running'", [CONVERSATION]);
      after = Number(active.rows[0].from);
      if (after === 0) after = Number((await pool.query("SELECT coalesce(max(seq), 0) AS m FROM turn_event")).rows[0].m);
    }
    const { rows } = await pool.query("SELECT seq, turn_id, chunk FROM turn_event WHERE conversation_id = $1 AND seq > $2 ORDER BY seq", [CONVERSATION, after]);
    let last = after;
    for (const r of rows) {
      res.write(`id: ${r.seq}\ndata: ${JSON.stringify({ seq: Number(r.seq), turnId: Number(r.turn_id), chunk: r.chunk, replay: true })}\n\n`);
      last = Number(r.seq);
    }
    set.delete(live);
    for (const line of held) if (Number(/^id: (\d+)/.exec(line)?.[1]) > last) res.write(line);
    set.add(res);
    req.on("close", () => set.delete(res));
    return;
  }
  res.writeHead(404).end();
}).listen(4984, () => console.log("turn server on http://localhost:4984"));
