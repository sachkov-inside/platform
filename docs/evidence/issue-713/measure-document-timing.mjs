// Замер для platform#713: время до первого байта и до полного документа на production-сборке web,
// число встроенных скриптов и наличие у них nonce. Порядок запуска — README рядом.
import { pathToFileURL } from "node:url";

const web = process.env.WEB ?? "http://127.0.0.1:3180";
const backend = process.env.BACKEND ?? "http://127.0.0.1:3190";
const samples = Number(process.env.SAMPLES ?? "7");
const delayMs = Number(process.env.DELAY_MS ?? "700");

const { wrapSession } = await import(pathToFileURL(`${process.cwd()}/node_modules/@logto/node/lib/src/index.js`).href);
const session = await wrapSession(
  {
    accessToken: JSON.stringify({ [`@${backend}`]: { expiresAt: Math.floor(Date.now() / 1_000) + 3_600, scope: "", token: "navigation-member-token" } }),
    idToken: "navigation.id.token",
    refreshToken: "navigation-refresh-token",
  },
  "inside-navigation-logto-cookie-secret-key",
);
const memberCookie = `logto_inside-web-navigation=${session}`;

await fetch(`${backend}/__control`, { body: JSON.stringify({ delayMs }), method: "POST" });

const pages = [
  ["Главная", "/"],
  ["продукт", "/guides/navigation-proof"],
  ["программа", "/guides/navigation-proof/programme"],
  ["бесплатный урок", "/materials/navigation-lesson-1?from=%2Fguides%2Fnavigation-proof%2Fprogramme"],
  ["платный урок", "/materials/navigation-lesson-3?from=%2Fguides%2Fnavigation-proof%2Fprogramme"],
];

async function once(path, cookie) {
  const started = performance.now();
  const response = await fetch(`${web}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  const reader = response.body.getReader();
  let firstByte;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    firstByte ??= performance.now() - started;
    chunks.push(value);
  }
  const total = performance.now() - started;
  const html = Buffer.concat(chunks).toString("utf8");
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gu)];
  return {
    firstByte,
    html,
    inlineBytes: inline.reduce((sum, match) => sum + Buffer.byteLength(match[2]), 0),
    inlineCount: inline.length,
    inlineWithNonce: inline.filter((match) => /\bnonce=/u.test(match[1])).length,
    status: response.status,
    total,
  };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
};

const rows = [];
for (const [label, path] of pages) {
  for (const [reader, cookie] of [["гость", undefined], ["вошедший", memberCookie]]) {
    await once(path, cookie); // прогрев общего кеша "use cache"
    const runs = [];
    for (let index = 0; index < samples; index += 1) runs.push(await once(path, cookie));
    const last = runs.at(-1);
    rows.push({
      page: label,
      reader,
      status: last.status,
      firstByteMs: median(runs.map((run) => run.firstByte)),
      totalMs: median(runs.map((run) => run.total)),
      inlineScripts: last.inlineCount,
      inlineScriptKb: Math.round(last.inlineBytes / 102.4) / 10,
      inlineWithNonce: last.inlineWithNonce,
    });
  }
}
console.log(JSON.stringify({ delayMs, samples, rows }, null, 2));
