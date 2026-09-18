/**
 * Подставной backend для проверок переходов на production-сборке (#670).
 *
 * Отдаёт один синтетический продукт с бесплатными и платными уроками в форме настоящего контракта
 * Nest. Ведёт счёт запросов и помнит, какие из них пришли с токеном: проверки читают это через
 * `/__requests`. `POST /__control` задаёт задержку ответа, чтобы скелет успевал показаться, и сбой
 * зависимости, чтобы проверить повтор после восстановления.
 */
import { createServer } from "node:http";

const port = Number(process.env.FAKE_BACKEND_PORT ?? "3190");
const guideId = "11111111-1111-4111-8111-111111111111";
const guideSlug = "navigation-proof";
const topic = { id: "22222222-2222-4222-8222-222222222222", name: "Переходы", slug: "navigation-topic" };
const format = { id: "guide", name: "Гайд", slug: "guide" };
export const protectedBodyMarker = "ЗАКРЫТОЕ-ТЕЛО-УРОКА";

/** Второй продукт написан для двух режимов прохождения: у его уроков личная часть есть всегда. */
const modesGuideId = "11111111-1111-4111-8111-111111111112";
const modesGuideSlug = "navigation-modes";
const guides = [
  { hasModeVariants: false, id: guideId, name: "Проверочный продукт", slug: guideSlug },
  { hasModeVariants: true, id: modesGuideId, name: "Продукт с режимами", slug: modesGuideSlug },
];

const lessons = [
  { n: 1, access: "free", guide: guides[0], title: "Первый бесплатный урок" },
  { n: 2, access: "free", guide: guides[0], title: "Второй бесплатный урок" },
  { n: 3, access: "membership", guide: guides[0], title: "Первый платный урок" },
  { n: 4, access: "membership", guide: guides[0], title: "Второй платный урок" },
  { n: 5, access: "free", guide: guides[1], title: "Первый урок с режимами" },
  { n: 6, access: "free", guide: guides[1], title: "Второй урок с режимами" },
].map(({ n, access, guide, title }) => ({
  access,
  contentVersion: 1,
  cover: null,
  difficulty: "basic",
  format,
  materialId: `33333333-3333-4333-8333-33333333330${String(n)}`,
  outcomes: ["Понимать, как устроен переход между страницами"],
  primaryVideoId: null,
  publishedAt: `2026-09-0${String(n)}T09:00:00.000Z`,
  seriesMemberships: [{ ordinal: n, series: { id: guide.id, name: guide.name, slug: guide.slug }, stepGroup: null }],
  slug: `navigation-lesson-${String(n)}`,
  summary: `Короткое описание урока ${String(n)} для проверки переходов.`,
  tags: [],
  title,
  topic,
}));
const lessonsOf = (guide) => lessons.filter((lesson) => lesson.seriesMemberships[0].series.id === guide.id);

const state = { delayMs: 0, requests: [], unavailable: false };

function projection(lesson, entitled) {
  return { ...lesson, availability: lesson.access === "free" || entitled ? "available" : "locked" };
}

function body(lesson, entitled) {
  const paragraphs = Array.from({ length: 12 }, (_, index) => ({
    kind: "paragraph",
    content: [{ kind: "text", marks: [], text: `${entitled ? protectedBodyMarker : "Открытый текст"} · ${lesson.title} · абзац ${String(index + 1)}. Текст нужен, чтобы страница была выше экрана и подвал не поднимался к скелету.` }],
  }));
  // Шаг, написанный для обоих режимов: какой вариант показать, выбирает сервер по режиму читателя.
  const step = { kind: "variant", options: ["example", "own"].map((mode) => ({ content: [{ kind: "paragraph", content: [{ kind: "text", marks: [], text: `ШАГ-ДЛЯ-РЕЖИМА-${mode}` }] }], mode })) };
  const written = lesson.seriesMemberships[0].series.id === modesGuideId ? [step] : [];
  return { schemaVersion: 1, blocks: [{ kind: "heading", level: 2, content: [{ kind: "text", marks: [], text: "Раздел урока" }] }, ...written, ...paragraphs] };
}

function readerProjection(lesson) {
  const { availability: _availability, ...rest } = projection(lesson, false);
  const { seriesMemberships, ...base } = rest;
  return { ...base, seriesMemberships: seriesMemberships.map(({ ordinal, series }) => ({ ordinal, series })) };
}

function collection(entitled) {
  const [guide] = guides;
  return {
    count: lessonsOf(guide).length,
    cover: null,
    id: guide.id,
    name: guide.name,
    previewItems: lessonsOf(guide).slice(0, 3).map((lesson) => projection(lesson, entitled)),
    slug: guide.slug,
    summary: "Синтетический продукт для проверки мгновенных переходов.",
  };
}

function route(method, url, entitled) {
  const path = url.pathname;
  if (method !== "GET") return undefined;
  if (path === "/library/home") {
    return json({
      guides: lessonsOf(guides[0]).map((lesson) => projection(lesson, entitled)),
      membership: { kind: entitled ? "active" : "unknown" },
      notes: [],
      // Закреплённый продукт приходит с оформлением и подписями карточки (#671).
      pinnedSeries: { ...collection(entitled), presentation: "default", card: { action: "Открыть продукт", eyebrow: "Продукт", subtitle: "Синтетический продукт проверок." } },
      playlists: [collection(entitled)],
      topics: [{ count: lessonsOf(guides[0]).length, cover: null, id: topic.id, name: topic.name, previewItems: [], slug: topic.slug, summary: "" }],
      videos: [],
    });
  }
  if (path === "/library/materials") {
    return json({
      facets: { formats: [], series: [], topics: [] },
      items: lessonsOf(guides[0]).map((lesson) => projection(lesson, entitled)),
      nextCursor: null,
      totalCount: lessonsOf(guides[0]).length,
    });
  }
  const discovery = /^\/library\/(guides|series|topics)\/([^/]+)$/u.exec(path);
  if (discovery !== null) {
    const [, kind, slug] = discovery;
    if (kind === "topics") {
      if (slug !== topic.slug) return discoveryNotFound();
      return json({ chapters: [], hasNext: false, items: [], kind: "topic", reference: { cover: null, hasModeVariants: false, id: topic.id, introduction: null, name: topic.name, slug: topic.slug, summary: "Тема для проверки переходов." }, relatedSeries: [], topics: [] });
    }
    const guide = guides.find((candidate) => candidate.slug === slug);
    if (guide === undefined) return discoveryNotFound();
    const items = lessonsOf(guide);
    const half = Math.ceil(items.length / 2);
    return json({
      chapters: [
        { id: `44444444-4444-4444-8444-44444444${guide.id.slice(-4)}`, materialIds: items.slice(0, half).map((lesson) => lesson.materialId), name: "Начало", summary: "Первые уроки." },
        { id: `44444444-4444-4444-8445-44444444${guide.id.slice(-4)}`, materialIds: items.slice(half).map((lesson) => lesson.materialId), name: "Продолжение", summary: "Следующие уроки." },
      ].filter((chapter) => chapter.materialIds.length > 0),
      hasNext: false,
      items: items.map((lesson) => projection(lesson, entitled)),
      kind: "series",
      reference: { cover: null, hasModeVariants: guide.hasModeVariants, id: guide.id, introduction: { audience: "Тем, кто проверяет переходы.", outcome: "Переходы без чужих скелетов.", prerequisites: "Ничего.", scope: "Несколько уроков." }, name: guide.name, slug: guide.slug, summary: "Синтетический продукт для проверки мгновенных переходов." },
      relatedSeries: [],
      topics: [{ cover: null, id: topic.id, name: topic.name, slug: topic.slug }],
    });
  }
  const related = /^\/library\/materials\/([^/]+)\/related$/u.exec(path);
  if (related !== null) {
    return json({ chapters: [], hasNext: false, items: [], kind: "related", reference: { cover: null, hasModeVariants: false, id: related[1], introduction: null, name: "Похожие", slug: related[1], summary: "" }, relatedSeries: [], topics: [] });
  }
  const material = /^\/materials\/([^/]+)$/u.exec(path);
  if (material !== null) {
    const lesson = lessons.find((candidate) => candidate.slug === material[1]);
    if (lesson === undefined) {
      return json({ code: "material_not_found", status: 404, title: "Material not found", type: "urn:inside:problem:material-not-found" }, 404);
    }
    if (lesson.access === "free" || entitled) {
      return json({ body: body(lesson, lesson.access !== "free"), cacheScope: lesson.access === "free" ? "public" : "private-no-store", kind: "available", primaryVideo: null, projection: readerProjection(lesson) });
    }
    return json({ access: { availability: "locked", subscriptionOffered: false }, cacheScope: "private-no-store", kind: "teaser", projection: readerProjection(lesson) });
  }
  // Вошедший читатель: проверкам хватает того, что аккаунт существует.
  if (path === "/accounts/current") {
    return entitled
      ? json({ account: { accountId: "55555555-5555-4555-8555-555555555501" } })
      : json({ code: "invalid_proof", detail: "Account request could not be completed.", status: 401, title: "Account verification failed", type: "https://inside.sachkov.com/problems/accounts/invalid-proof" }, 401);
  }
  if (/^\/guides\/[^/]+\/artifacts$/u.test(path)) return json({ artifacts: [] });
  // Продукт продаётся, как в production: у программы с закрытыми уроками есть приглашение к оплате.
  if (path === "/billing/offers") {
    const offerId = "66666666-6666-4666-8666-666666666601";
    return json({
      items: [{
        currency: "RUB",
        firstPriceKopecks: 990_000,
        offer: { archived: false, benefitPeriods: [{ capability: `guide:${guideId}`, months: null }], benefits: [`guide:${guideId}`], id: offerId, name: "Проверочный продукт", published: true, revision: 1 },
        paymentOption: { archived: false, id: "66666666-6666-4666-8666-666666666602", mode: "one_time", months: 1, offerId, priceKopecks: 990_000, revision: 1 },
        promotion: null,
        renewalPriceKopecks: 990_000,
        timezone: "Europe/Moscow",
      }],
      nextCursor: null,
    });
  }
  return undefined;
}

function json(value, status = 200) {
  return { status, value };
}

function discoveryNotFound() {
  return json({ code: "discovery_not_found", status: 404, title: "Discovery not found", type: "urn:inside:problem:discovery-not-found" }, 404);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${String(port)}`);
  const send = (status, value) => {
    response.writeHead(status, { "cache-control": "private, no-store", "content-type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (url.pathname === "/__requests") {
    if (request.method === "DELETE") state.requests = [];
    send(200, { requests: state.requests });
    return;
  }
  if (url.pathname === "/__control" && request.method === "POST") {
    const control = JSON.parse(await readBody(request));
    if (typeof control.delayMs === "number") state.delayMs = control.delayMs;
    if (typeof control.unavailable === "boolean") state.unavailable = control.unavailable;
    send(200, { delayMs: state.delayMs, unavailable: state.unavailable });
    return;
  }
  const authorized = request.headers.authorization !== undefined;
  state.requests.push({ authorized, method: request.method, path: `${url.pathname}${url.search}` });
  // Авторская запись закрепа: набор сбрасывает ею общий кеш web, как это делает автор в жизни.
  if (url.pathname === "/authoring/home-pin" && request.method === "PUT") {
    const { expectedVersion, seriesId } = JSON.parse(await readBody(request));
    if (authorized) send(200, { seriesId, version: expectedVersion + 1 });
    else send(401, { code: "invalid_proof", status: 401, title: "Account verification failed", type: "https://inside.sachkov.com/problems/accounts/invalid-proof" });
    return;
  }
  const result = state.unavailable
    ? json({ code: "dependency_unavailable", retryable: true, status: 503, title: "Dependency unavailable", type: "urn:inside:problem:dependency-unavailable" }, 503)
    : route(request.method, url, authorized);
  if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
  if (result === undefined) {
    send(404, { code: "not_found", status: 404, title: "Not found", type: "about:blank" });
    return;
  }
  send(result.status, result.value);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake backend listens on http://127.0.0.1:${String(port)}`);
});
