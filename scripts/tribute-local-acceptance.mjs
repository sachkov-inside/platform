import { createRequire } from "node:module";
import { randomUUID, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const backendRequire = createRequire(new URL("../apps/backend/package.json", import.meta.url));
const { chromium, expect: baseExpect } = webRequire("@playwright/test");
const { AxeBuilder } = webRequire("@axe-core/playwright");
const { Client } = backendRequire("pg");
const expect = baseExpect.configure({ timeout: 30000 });
const web = "http://127.0.0.1:3600", telegram = "http://127.0.0.1:3606", identity = "https://identity.inside.localhost:3631";
const user = Number(process.env.TRIBUTE_PROOF_USER), output = process.env.TRIBUTE_PROOF_OUTPUT, ownerState = process.env.TRIBUTE_PROOF_OWNER_STATE;
if (!/^64[0-9]{5}$/u.test(String(user)) || !output || !ownerState) throw new Error("Fresh synthetic user64xxxxx, output and owner browser state are required");
const database = new URL(process.env.DATABASE_URL ?? "");
if (database.hostname !== "127.0.0.1" || database.port !== "55439" || database.pathname !== "/inside") throw new Error("Only handed-over synthetic Platform DB is allowed");
if (!process.env.TRIBUTE_API_KEY || process.env.TRIBUTE_SIGNATURE_ENCODING !== "hex") throw new Error("Synthetic hex Tribute ingress required");
const sql = new Client({ connectionString: database.toString() }); await sql.connect();
// SQL below is read-only observation of real ingress and application effects, never seeding grants or identities.
const browser = await chromium.launch({ headless: true });
const viewport = process.env.TRIBUTE_PROOF_MOBILE === "true" ? { width: 390, height: 844 } : { width: 1440, height: 1024 };
const owner = await browser.newContext({ storageState: ownerState, ignoreHTTPSErrors: true, viewport });
const ownerPage = await owner.newPage();
const buyer = await browser.newContext({ ignoreHTTPSErrors: true, viewport }); const page = await buyer.newPage();
const report = { scope: "real Platform and accepted Telegram AppModule with real PG; external providers only are synthetic", scenarios: [], evidence: [], code: `tribute_${String(user)}` };
await mkdir(output, { recursive: true });
let updateId = Date.now() % 1000000000;
const from = { id: user, is_bot: false, first_name: "Synthetic" }, chat = { id: user, type: "private" };
async function update(body) { const response = await buyer.request.post(`${telegram}/webhooks/telegram`, { headers: { "x-telegram-bot-api-secret-token": "synthetic-course64-webhook" }, data: { update_id: ++updateId, ...body } }); expect(response.status()).toBe(202); }
async function send(text) { await update({ message: { message_id: updateId, date: Math.floor(Date.now()/1000), from, chat, text } }); }
async function messages() { return (await (await buyer.request.get(`${telegram}/proof/state`)).json()).messages.filter(row => row.chatId === String(user)); }
async function command(path, input) {
  const response = await owner.request.post(`${web}/api/authoring/billing/${path}`, { headers: { origin: web }, multipart: { input: JSON.stringify(input) } });
  expect(response.status()).toBe(200); const result = await response.json();
  if (!result.ok) throw new Error(`Owner command ${path} failed: ${String(result.code)}`);
  return result.value.result;
}
async function ownEnrollments() { const response = await buyer.request.get(`${web}/api/account/billing/enrollments`); expect(response.status()).toBe(200); const result = await response.json(); expect(result.ok).toBe(true); return result.value.items; }
try {
  await ownerPage.goto(`${web}/authoring/billing`);
  await expect(ownerPage.getByRole("heading", { name: "Перенос доступа из Tribute" })).toBeVisible();
  const tiers = await command("tiers/list", { operationId: randomUUID(), limit: 100 });
  const tier = tiers.items.find(row => row.availableForAssignment && !row.archived && row.tier.benefits.includes("materials"));
  if (!tier) throw new Error("Prepared local tier required");
  const policyRef = `tribute625-${String(user)}`;
  await command("tribute/save-policy", { operationId: randomUUID(), id: policyRef, subscriptionId: user, expectedRevision: 0, enabled: true, tierId: tier.tier.id, tierRevision: tier.tier.revision, temporaryUntil: null, reason: "Synthetic acceptance625 confirmed registry policy" });
  const ruleId = randomUUID();
  await command("activation-rules/save", { operationId: randomUUID(), value: { id: ruleId, code: report.code, name: "Tribute625 synthetic acceptance", tierId: tier.tier.id, tierRevision: tier.tier.revision, sourceRef: policyRef, verificationMode: "tribute_registry", published: true, startsAt: new Date(Date.now()-60000).toISOString(), endsAt: null }, reason: "Synthetic registry-only activation" });
  await buyer.request.post(`${telegram}/proof/source`, { data: { user: String(user), source: "left", community: "not_member" } });
  await send(`/start a_${report.code}`);
  await expect.poll(async () => (await messages()).some(row => row.buttons?.some(button => button.url === `${web}/account`))).toBe(true);
  await expect.poll(async () => (await sql.query("SELECT count(*)::int AS count FROM membership_entitlements.activation_attempts WHERE rule_id=$1", [ruleId])).rows[0].count, { timeout: 90000 }).toBe(1);
  const attempt = await sql.query("SELECT identity_ref, account_id FROM membership_entitlements.activation_attempts WHERE rule_id=$1", [ruleId]);
  expect(attempt.rows).toHaveLength(1); expect(attempt.rows[0].account_id).toBeNull();
  const identityRef = attempt.rows[0].identity_ref;
  const startsAt = new Date(Date.now()-10000).toISOString(), endsAt = new Date(Date.now()+86400000*20).toISOString();
  const row = { rowRef: `verified-${String(user)}`, policyRef, subscriptionId: user, identityRef, telegramUserId: String(user), verificationRef: `real-private-ingress-${String(updateId)}`, checkedAt: new Date().toISOString(), mode: "confirmed_period", startsAt, endsAt, renewal: "enabled", expectedRevision: 0, reason: "Synthetic period confirmed independently of source chat" };
  const preview = await command("tribute/preview", { operationId: randomUUID(), batchRef: `batch-${String(user)}`, rows: [row] });
  expect(preview.value.rows[0].status).toBe("pending_identity");
  const apply = { operationId: randomUUID(), previewRef: preview.value.previewRef, selectedRows: [row.rowRef] };
  const imported = await command("tribute/apply", apply); expect(imported.value.sources[0].accountId).toBeNull();
  report.scenarios.push("PASS pending registry import after actual private ingress creates neither Account nor grant");
  await page.goto(`${web}/account`);
  await page.locator("#content").getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("button", { name: /Telegram/u }).click();
  await expect(page.locator("#bot")).toBeVisible();
  const loginToken = new URL(await page.locator("#bot").getAttribute("href")).searchParams.get("start");
  const login = await (await page.request.get(`${identity}/api/inside-telegram/status`)).json(); expect(login.status).toBe("pending");
  await send(`/start ${String(loginToken)}`);
  await expect.poll(async () => (await messages()).some(message => message.buttons?.some(button => button.callbackData === `signin:approve:${String(login.requestRef)}`))).toBe(true);
  const approval = (await messages()).find(message => message.buttons?.some(button => button.callbackData === `signin:approve:${String(login.requestRef)}`));
  await update({ callback_query: { id: `proof625-${String(updateId)}`, from, chat_instance: "synthetic", message: { message_id: Number(approval.id), date: Math.floor(Date.now()/1000), chat }, data: `signin:approve:${String(login.requestRef)}` } });
  await expect.poll(async () => (await (await buyer.request.get(`${web}/auth/status`)).json()).state, { timeout: 60000 }).toBe("authenticated");
  await expect.poll(async () => (await ownEnrollments()).filter(item => item.origin === "tribute").length, { timeout: 90000 }).toBe(1);
  const first = (await ownEnrollments()).find(item => item.origin === "tribute");
  expect(first.endsAt).toBe(endsAt); expect(first.endPolicy).toBe("confirmed_external"); expect(first.state).toBe("active");
  await expect.poll(async () => {
    const result = await sql.query("SELECT count(*)::int AS count FROM membership_entitlements.access_receipts WHERE scope='source-evidence' AND payload->>'identityRef'=$1 AND payload->>'decision'='registry_lookup'", [identityRef]);
    return result.rows[0].count;
  }, { timeout: 90000 }).toBeGreaterThan(0);
  report.scenarios.push("PASS actual Telegram linking and registry activation gives one finite Platform Enrollment while course source is left");
  await send("/access");
  await expect.poll(async () => (await messages()).some(message => message.text.includes("Tribute"))).toBe(true);
  await send(`/start a_${report.code}`);
  const replay = await command("tribute/apply", apply); expect(replay.value).toEqual(imported.value);
  expect((await ownEnrollments()).filter(item => item.origin === "tribute")).toHaveLength(1);
  report.scenarios.push("PASS duplicate link and exact apply receipt preserve one Enrollment and original finite term");
  const expiresAt = new Date(Date.parse(endsAt)+86400000*10).toISOString();
  const event = { name: "renewed_subscription", created_at: new Date().toISOString(), sent_at: new Date().toISOString(), payload: { subscription_name: "Synthetic625", subscription_id: user, period_id: 1, period: "monthly", price: 10000, amount: 9000, currency: "rub", user_id: user, trb_user_id: `T-${String(user)}`, telegram_user_id: user, channel_id: 625, channel_name: "Synthetic", expires_at: expiresAt, type: "regular" } };
  async function tributeEvent(document) {
    const raw = JSON.stringify(document); const response = await buyer.request.post("http://127.0.0.1:3601/integrations/tribute/v1/webhook", { headers: { "content-type": "application/json", "trbt-signature": createHmac("sha256", process.env.TRIBUTE_API_KEY).update(raw).digest("hex") }, data: raw });
    expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toBe("private, no-store"); return response.json();
  }
  expect((await tributeEvent(event)).status).toBe("applied"); expect((await tributeEvent(event)).status).toBe("duplicate");
  expect((await ownEnrollments()).find(item => item.id === first.id).endsAt).toBe(expiresAt);
  const cancel = { ...event, name: "cancelled_subscription", created_at: new Date().toISOString(), sent_at: new Date().toISOString(), payload: { ...event.payload, cancel_reason: "" } };
  expect((await tributeEvent(cancel)).status).toBe("applied");
  expect((await ownEnrollments()).find(item => item.id === first.id)).toMatchObject({ endsAt: expiresAt, state: "active" });
  report.scenarios.push("PASS signed HTTP renewal/dedup/cancel retains exact paid remainder on real account");
  const purchaseCount = await sql.query("SELECT count(*)::int AS count FROM billing.purchases WHERE account_id=$1", [first.accountId]); expect(purchaseCount.rows[0].count).toBe(0);
  await page.goto(`${web}/account/subscription`); await expect(page.getByText("Оплачено через Tribute", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations.filter(item => item.impact === "serious" || item.impact === "critical")).toEqual([]);
  await page.screenshot({ path: resolve(output, "tribute-account.png"), fullPage: true }); report.evidence.push("tribute-account.png");
  await ownerPage.reload(); await ownerPage.getByText("Источники и восстановление", { exact: true }).click();
  const sourceSummary = ownerPage.locator("summary").filter({ hasText: identityRef });
  await expect(sourceSummary).toBeVisible(); await sourceSummary.click();
  await expect(ownerPage.getByText(`Источник ${policyRef}`, { exact: false })).toBeVisible();
  expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ownerPage.getByRole("heading", { name: "Перенос доступа из Tribute" }).scrollIntoViewIfNeeded();
  const section = ownerPage.getByRole("heading", { name: "Перенос доступа из Tribute" }).locator("..");
  await section.screenshot({ path: resolve(output, "tribute-owner.png") }); report.evidence.push("tribute-owner.png");
  report.scenarios.push("PASS actual account and owner UI; no login/token screenshot persisted");
  await writeFile(resolve(output, "acceptance.json"), JSON.stringify(report, null, 2)+"\n");
  process.stdout.write(JSON.stringify({ passed: report.scenarios.length, output })+"\n");
} finally { await browser.close(); await sql.end(); }
