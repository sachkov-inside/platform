// PROTOTYPE, throwaway (#1984). Drives the turn server like two tabs and a reload, and prints what each saw.
const base = "http://localhost:4984";
type Event = { seq: number; chunk: { type: string; delta?: string; status?: string }; replay?: boolean };

function tab(name: string, after: number) {
  const controller = new AbortController();
  const events: Event[] = [];
  const done = (async () => {
    const res = await fetch(`${base}/api/events?after=${after}`, { signal: controller.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (data) events.push(JSON.parse(data));
        }
      }
    } catch {}
  })();
  return { name, events, close: () => controller.abort(), done };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (events: Event[]) => events.filter((e) => e.chunk.type === "text-delta").map((e) => e.chunk.delta).join("");
const statuses = (events: Event[]) => events.filter((e) => e.chunk.type === "turn-status").map((e) => e.chunk.status);

const scenario = process.argv[2] ?? "tabs";
if (scenario === "tabs") {
  const a = tab("A", -1);
  const b = tab("B", -1);
  await sleep(300);
  const posted = Date.now();
  await fetch(`${base}/api/message`, { method: "POST", body: JSON.stringify({ text: "две вкладки" }) });
  console.log("POST returned after", Date.now() - posted, "ms (the turn goes on without the request)");
  console.log("second POST during the turn:", (await fetch(`${base}/api/message`, { method: "POST", body: JSON.stringify({ text: "ещё" }) })).status);
  await sleep(2000);
  // Tab B reloads: it drops its connection and opens a new one asking for the active turn from its start.
  b.close();
  const lastSeenByB = b.events.at(-1)?.seq;
  await sleep(1000); // events B misses while it is away
  const b2 = tab("B after reload", -1);
  await sleep(2000);
  // Tab C reconnects after a network break naming its last seq, like EventSource with Last-Event-ID.
  const c = tab("C", -1);
  await sleep(500);
  c.close();
  const cLast = c.events.at(-1)!.seq;
  await sleep(800);
  const c2 = tab("C after network break", cLast);
  await sleep(1500);
  await fetch(`${base}/api/stop`, { method: "POST" });
  await sleep(600);
  for (const t of [a, b2, c2]) t.close();
  const seqs = (e: Event[]) => e.map((x) => x.seq);
  const gaps = (e: Event[]) => seqs(e).some((s, i, all) => i > 0 && s !== all[i - 1] + 1);
  console.log({
    A: { events: a.events.length, statuses: statuses(a.events), chars: text(a.events).length, gaps: gaps(a.events) },
    "B before reload": { events: b.events.length, lastSeq: lastSeenByB },
    "B after reload": { events: b2.events.length, replayed: b2.events.filter((e) => e.replay).length, statuses: statuses(b2.events), sameTextAsA: text(b2.events) === text(a.events), gaps: gaps(b2.events) },
    "C after break": { from: cLast, firstSeq: c2.events[0]?.seq, replayed: c2.events.filter((e) => e.replay).length, gaps: gaps([...c.events, ...c2.events]), sameTailAsA: text([...c.events, ...c2.events]) === text(a.events.filter((e) => e.seq >= c.events[0].seq)) },
  });
  const history = await (await fetch(`${base}/api/history`)).json();
  console.log("saved turn:", history.at(-1).status, history.at(-1).answer.length, "chars");
}
if (scenario === "start") {
  await fetch(`${base}/api/message`, { method: "POST", body: JSON.stringify({ text: "перезапуск сервера" }) });
  await sleep(1500);
  console.log("turn started; kill the server now");
}
if (scenario === "after-restart") {
  const t = tab("after restart", -1);
  await sleep(500);
  t.close();
  const history = await (await fetch(`${base}/api/history`)).json();
  console.log("last turn:", history.at(-1).question, history.at(-1).status);
}
