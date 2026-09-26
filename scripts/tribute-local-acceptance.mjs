import { createRequire } from "node:module";
import { randomUUID, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const webRequire = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const backendRequire = createRequire(
  new URL("../apps/backend/package.json", import.meta.url),
);
const { chromium, expect: baseExpect } = webRequire("@playwright/test");
const { AxeBuilder } = webRequire("@axe-core/playwright");
const { Client } = backendRequire("pg");
const expect = baseExpect.configure({ timeout: 30000 });
const web = "http://127.0.0.1:3600",
  telegram = "http://127.0.0.1:3606",
  identity = "https://identity.inside.localhost:3631";
const negative = process.env.TRIBUTE_PROOF_NEGATIVE;
if (negative !== undefined && !["unknown_period", "nonpaid"].includes(negative))
  throw new Error("Unsupported negative fixture");
const user = Number(process.env.TRIBUTE_PROOF_USER),
  output = process.env.TRIBUTE_PROOF_OUTPUT,
  ownerState = process.env.TRIBUTE_PROOF_OWNER_STATE;
if (!/^64[0-9]{5}$/u.test(String(user)) || !output || !ownerState)
  throw new Error(
    "Fresh synthetic user64xxxxx, output and owner browser state are required",
  );
const database = new URL(process.env.DATABASE_URL ?? "");
if (
  database.hostname !== "127.0.0.1" ||
  database.port !== "55439" ||
  database.pathname !== "/inside"
)
  throw new Error("Only handed-over synthetic Platform DB is allowed");
if (
  !process.env.TRIBUTE_API_KEY ||
  process.env.TRIBUTE_SIGNATURE_ENCODING !== "hex"
)
  throw new Error("Synthetic hex Tribute ingress required");
const sql = new Client({ connectionString: database.toString() });
await sql.connect();
// SQL below is read-only observation of real ingress and application effects, never seeding grants or identities.
const browser = await chromium.launch({ headless: true });
const viewport =
  process.env.TRIBUTE_PROOF_MOBILE === "true"
    ? { width: 390, height: 844 }
    : { width: 1440, height: 1024 };
const owner = await browser.newContext({
  storageState: ownerState,
  ignoreHTTPSErrors: true,
  viewport,
});
const ownerPage = await owner.newPage();
const buyer = await browser.newContext({ ignoreHTTPSErrors: true, viewport });
const page = await buyer.newPage();
const report = {
  scope:
    "real Platform and accepted Telegram AppModule with real PG; external providers only are synthetic",
  scenarios: [],
  evidence: [],
  code: `tribute_${String(user)}`,
};
await mkdir(output, { recursive: true });
let updateId = Date.now() % 1000000000;
const from = { id: user, is_bot: false, first_name: "Synthetic" },
  chat = { id: user, type: "private" };
async function update(body) {
  const response = await buyer.request.post(`${telegram}/webhooks/telegram`, {
    headers: {
      "x-telegram-bot-api-secret-token": "synthetic-course64-webhook",
    },
    data: { update_id: ++updateId, ...body },
  });
  expect(response.status()).toBe(202);
}
async function send(text) {
  await update({
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      from,
      chat,
      text,
    },
  });
}
async function messages() {
  return (
    await (await buyer.request.get(`${telegram}/proof/state`)).json()
  ).messages.filter((row) => row.chatId === String(user));
}
async function command(path, input) {
  const response = await owner.request.post(
    `${web}/api/authoring/billing/${path}`,
    { headers: { origin: web }, multipart: { input: JSON.stringify(input) } },
  );
  expect(response.status()).toBe(200);
  const result = await response.json();
  if (!result.ok)
    throw new Error(`Owner command ${path} failed: ${String(result.code)}`);
  return result.value.result;
}
async function ownEnrollments() {
  const response = await buyer.request.get(
    `${web}/api/account/billing/enrollments`,
  );
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.value.items;
}
try {
  await ownerPage.goto(`${web}/authoring/billing`);
  await expect(
    ownerPage.getByRole("heading", { name: "Перенос доступа из Tribute" }),
  ).toBeVisible();
  const tiers = await command("tiers/list", {
    operationId: randomUUID(),
    limit: 100,
  });
  let tier = tiers.items.find(
    (row) =>
      row.availableForAssignment &&
      !row.archived &&
      row.tier.benefits.includes("materials"),
  );
  if (!tier) throw new Error("Prepared local tier required");
  const tierId = randomUUID();
  await command("offers/save", {
    operationId: randomUUID(),
    value: {
      id: tierId,
      name: `Tribute acceptance ${String(user)}`,
      benefits: tier.tier.benefits,
      contentScope: tier.tier.contentScope,
      availableForAssignment: true,
    },
  });
  tier = {
    ...tier,
    tier: {
      ...tier.tier,
      id: tierId,
      revision: 1,
      name: `Tribute acceptance ${String(user)}`,
    },
  };
  const policyRef = `tribute625-${String(user)}`;
  await command("tribute/save-policy", {
    operationId: randomUUID(),
    id: policyRef,
    subscriptionId: user,
    expectedRevision: 0,
    enabled: true,
    tierId: tier.tier.id,
    tierRevision: tier.tier.revision,
    temporaryUntil: null,
    reason: "Synthetic acceptance625 confirmed registry policy",
  });
  const ruleId = randomUUID();
  await command("activation-rules/save", {
    operationId: randomUUID(),
    value: {
      id: ruleId,
      code: report.code,
      name: "Tribute625 synthetic acceptance",
      tierId: tier.tier.id,
      tierRevision: tier.tier.revision,
      sourceRef: policyRef,
      verificationMode: "tribute_registry",
      published: true,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: null,
    },
    reason: "Synthetic registry-only activation",
  });
  await buyer.request.post(`${telegram}/proof/source`, {
    data: {
      user: String(user),
      source: negative ? "member" : "left",
      community: "not_member",
    },
  });
  await send(`/start a_${report.code}`);
  await expect
    .poll(async () =>
      (await messages()).some((row) =>
        row.buttons?.some((button) => button.url === `${web}/account`),
      ),
    )
    .toBe(true);
  await expect
    .poll(
      async () =>
        (
          await sql.query(
            "SELECT count(*)::int AS count FROM membership_entitlements.activation_attempts WHERE rule_id=$1",
            [ruleId],
          )
        ).rows[0].count,
      { timeout: 90000 },
    )
    .toBe(1);
  const attempt = await sql.query(
    "SELECT identity_ref, account_id FROM membership_entitlements.activation_attempts WHERE rule_id=$1",
    [ruleId],
  );
  expect(attempt.rows).toHaveLength(1);
  expect(attempt.rows[0].account_id).toBeNull();
  const identityRef = attempt.rows[0].identity_ref;
  const startsAt = new Date(Date.now() - 10000).toISOString(),
    endsAt = new Date(Date.now() + 86400000 * 20).toISOString();
  const row = {
    rowRef: `verified-${String(user)}`,
    policyRef,
    subscriptionId: user,
    identityRef,
    telegramUserId: String(user),
    verificationRef: `real-private-ingress-${String(updateId)}`,
    checkedAt: new Date().toISOString(),
    mode: "confirmed_period",
    startsAt,
    endsAt,
    renewal: "enabled",
    expectedRevision: 0,
    reason: "Synthetic period confirmed independently of source chat",
  };
  const preview = await command("tribute/preview", {
    operationId: randomUUID(),
    batchRef: `batch-${String(user)}`,
    rows: [{ ...row, ...(negative ? { endsAt: null } : {}) }],
  });
  expect(preview.value.rows[0].status).toBe(
    negative ? "unknown_term" : "pending_identity",
  );
  const apply = {
    operationId: randomUUID(),
    previewRef: preview.value.previewRef,
    selectedRows: [row.rowRef],
  };
  const imported = negative ? null : await command("tribute/apply", apply);
  if (imported) expect(imported.value.sources[0].accountId).toBeNull();
  if (negative === "nonpaid") {
    const trial = {
      name: "new_subscription",
      created_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      payload: {
        subscription_name: "Synthetic trial",
        subscription_id: user,
        period_id: 1,
        period: "monthly",
        price: 10000,
        amount: 0,
        currency: "rub",
        user_id: user,
        trb_user_id: `T-${String(user)}`,
        telegram_user_id: user,
        channel_id: 625,
        channel_name: "Synthetic",
        expires_at: endsAt,
        type: "trial",
      },
    };
    const raw = JSON.stringify(trial);
    const response = await buyer.request.post(
      "http://127.0.0.1:3601/integrations/tribute/v1/webhook",
      {
        headers: {
          "content-type": "application/json",
          "trbt-signature": createHmac("sha256", process.env.TRIBUTE_API_KEY)
            .update(raw)
            .digest("hex"),
        },
        data: raw,
      },
    );
    expect(response.status()).toBe(200);
    expect((await response.json()).status).toBe("pending_reconciliation");
  }
  report.scenarios.push(
    "PASS pending registry import after actual private ingress creates neither Account nor grant",
  );
  await page.goto(`${web}/account`);
  await page
    .locator("#content")
    .getByRole("button", { name: "Войти", exact: true })
    .click();
  await page.getByRole("button", { name: /Telegram/u }).click();
  await expect(page.locator("#bot")).toBeVisible();
  const loginToken = new URL(
    await page.locator("#bot").getAttribute("href"),
  ).searchParams.get("start");
  const login = await (
    await page.request.get(`${identity}/api/inside-telegram/status`)
  ).json();
  expect(login.status).toBe("pending");
  await send(`/start ${String(loginToken)}`);
  await expect
    .poll(async () =>
      (await messages()).some((message) =>
        message.buttons?.some(
          (button) =>
            button.callbackData ===
            `signin:approve:${String(login.requestRef)}`,
        ),
      ),
    )
    .toBe(true);
  const approval = (await messages()).find((message) =>
    message.buttons?.some(
      (button) =>
        button.callbackData === `signin:approve:${String(login.requestRef)}`,
    ),
  );
  await update({
    callback_query: {
      id: `proof625-${String(updateId)}`,
      from,
      chat_instance: "synthetic",
      message: {
        message_id: Number(approval.id),
        date: Math.floor(Date.now() / 1000),
        chat,
      },
      data: `signin:approve:${String(login.requestRef)}`,
    },
  });
  await expect
    .poll(
      async () =>
        (await (await buyer.request.get(`${web}/auth/status`)).json()).state,
      { timeout: 60000 },
    )
    .toBe("authenticated");
  if (negative) {
    await expect
      .poll(
        async () =>
          (
            await sql.query(
              "SELECT count(*)::int AS count FROM membership_entitlements.access_receipts WHERE scope='source-evidence' AND payload->>'identityRef'=$1 AND payload->>'decision'='registry_lookup'",
              [identityRef],
            )
          ).rows[0].count,
        { timeout: 90000 },
      )
      .toBeGreaterThan(0);
    expect(await ownEnrollments()).toHaveLength(0);
    expect(
      (
        await sql.query(
          "SELECT count(*)::int AS count FROM billing.purchases WHERE account_id IN (SELECT account_id FROM membership_entitlements.activation_attempts WHERE identity_ref=$1)",
          [identityRef],
        )
      ).rows[0].count,
    ).toBe(0);
    await send("/access");
    await expect
      .poll(async () =>
        (await messages()).some((message) =>
          /проверк|подтвержд/iu.test(message.text),
        ),
      )
      .toBe(true);
    await page.goto(`${web}/account/subscription`);
    await page.screenshot({
      path: resolve(output, "tribute-pending.png"),
      fullPage: true,
    });
    report.evidence.push("tribute-pending.png");
    report.scenarios.push(
      `PASS actual registry activation with source member and ${negative} creates no Enrollment or billing charge`,
    );
  } else {
    await expect
      .poll(
        async () =>
          (await ownEnrollments()).filter((item) => item.origin === "tribute")
            .length,
        { timeout: 90000 },
      )
      .toBe(1);
    const first = (await ownEnrollments()).find(
      (item) => item.origin === "tribute",
    );
    expect(first.endsAt).toBe(endsAt);
    expect(first.endPolicy).toBe("confirmed_external");
    expect(first.state).toBe("active");
    await expect
      .poll(
        async () => {
          const result = await sql.query(
            "SELECT count(*)::int AS count FROM membership_entitlements.access_receipts WHERE scope='source-evidence' AND payload->>'identityRef'=$1 AND payload->>'decision'='registry_lookup'",
            [identityRef],
          );
          return result.rows[0].count;
        },
        { timeout: 90000 },
      )
      .toBeGreaterThan(0);
    report.scenarios.push(
      "PASS actual Telegram linking and registry activation gives one finite Platform Enrollment while course source is left",
    );
    await page.goto(`${web}/materials/developer-pipeline-bez-poteri-konteksta`);
    await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
    report.scenarios.push(
      "PASS Tribute registry grant opens the protected included material through real Reader/BFF/Platform",
    );
    const includedGuide = tier.tier.contentScope?.guideIds[0];
    if (!includedGuide)
      throw new Error("Acceptance tier must name an included Guide");
    const metadata = (
      await sql.query(
        "SELECT topic_id FROM materials.materials WHERE slug=$1",
        ["developer-pipeline-bez-poteri-konteksta"],
      )
    ).rows[0];
    const materialFields = {
      access: "membership",
      difficulty: "unassigned",
      formatId: "guide",
      topicId: metadata.topic_id,
      title: `Tribute625 new included material ${String(user)}`,
      summary: "Synthetic new material in the already included Guide",
      seriesIds: JSON.stringify([includedGuide]),
      document: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "New Guide material after the original confirmed enrollment.",
              },
            ],
          },
        ],
      }),
    };
    const createdResponse = await owner.request.post(
      `${web}/api/authoring/materials`,
      {
        headers: { origin: web },
        multipart: { ...materialFields, submissionId: randomUUID() },
      },
    );
    expect(createdResponse.status()).toBe(200);
    const created = await createdResponse.json();
    expect(created.kind).toBe("created");
    const publishedResponse = await owner.request.put(
      `${web}/api/authoring/materials`,
      {
        headers: { origin: web },
        multipart: {
          ...materialFields,
          submissionId: randomUUID(),
          materialId: created.draft.materialId,
          expectedContentVersion: String(created.draft.contentVersion),
          publicationState: "published",
        },
      },
    );
    expect(publishedResponse.status()).toBe(200);
    expect((await publishedResponse.json()).kind).toBe("saved");
    const material = (
      await sql.query("SELECT slug FROM materials.materials WHERE id=$1", [
        created.draft.materialId,
      ])
    ).rows[0];
    await page.goto(`${web}/materials/${material.slug}`);
    await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
    expect(
      (await ownEnrollments()).find((item) => item.id === first.id),
    ).toEqual(first);
    report.scenarios.push(
      "PASS newly published material inside the included Guide opens without replacing or extending the existing Enrollment",
    );
    const secondHolder = (
      await (await owner.request.get(`${web}/auth/status`)).json()
    ).accountId;
    const unselected = await command("enrollments/assign", {
      operationId: randomUUID(),
      accountId: secondHolder,
      origin: "manual",
      sourceRef: `unselected625-${String(user)}`,
      tierId,
      tierRevision: 1,
      terms: { startsAt, endsAt, endPolicy: "fixed" },
      billingRef: null,
      reason: "Synthetic unselected cohort comparator",
    });
    const secondBefore = (
      await command("enrollments/list", {
        operationId: randomUUID(),
        accountId: secondHolder,
      })
    ).items.find((item) => item.id === unselected.value.id);
    const guideResponse = await owner.request.post(
      `${web}/api/authoring/collections`,
      {
        headers: { origin: web },
        multipart: {
          kind: "series",
          name: `New Guide ${String(user)}`,
          slug: `new-guide-${String(user)}`,
          summary: "Synthetic catalog expansion acceptance",
        },
      },
    );
    expect(guideResponse.status()).toBe(200);
    const newGuide = (await guideResponse.json()).collection;
    const newFields = {
      ...materialFields,
      title: `New excluded Guide material ${String(user)}`,
      seriesIds: JSON.stringify([newGuide.id]),
    };
    const newDraftResponse = await owner.request.post(
      `${web}/api/authoring/materials`,
      {
        headers: { origin: web },
        multipart: { ...newFields, submissionId: randomUUID() },
      },
    );
    expect(newDraftResponse.status()).toBe(200);
    const newDraft = (await newDraftResponse.json()).draft;
    const newPublished = await owner.request.put(
      `${web}/api/authoring/materials`,
      {
        headers: { origin: web },
        multipart: {
          ...newFields,
          submissionId: randomUUID(),
          materialId: newDraft.materialId,
          expectedContentVersion: String(newDraft.contentVersion),
          publicationState: "published",
        },
      },
    );
    expect(newPublished.status()).toBe(200);
    expect((await newPublished.json()).kind).toBe("saved");
    const newMaterial = (
      await sql.query("SELECT slug FROM materials.materials WHERE id=$1", [
        newDraft.materialId,
      ])
    ).rows[0];
    await page.goto(`${web}/materials/${newMaterial.slug}`);
    await expect(
      page.locator('[data-material-reader-state="access-required"]:visible'),
    ).toBeVisible();
    await command("offers/save", {
      operationId: randomUUID(),
      expectedRevision: 1,
      value: {
        id: tierId,
        name: "Changed next cohort",
        benefits: tier.tier.benefits,
        contentScope: {
          ...tier.tier.contentScope,
          guideIds: [...tier.tier.contentScope.guideIds, newGuide.id],
        },
        availableForAssignment: true,
      },
    });
    expect(
      (await ownEnrollments()).find((item) => item.id === first.id),
    ).toEqual(first);
    await page.reload();
    await expect(
      page.locator('[data-material-reader-state="access-required"]:visible'),
    ).toBeVisible();
    const expansion = await command("enrollments/preview-expansion", {
      operationId: randomUUID(),
      tierId,
      tierRevision: 2,
      targets: [
        {
          enrollmentId: first.id,
          expectedRevision: first.revision,
          tierRevision: 1,
        },
      ],
      reason: "Synthetic explicitly selected existing cohort",
    });
    await command("enrollments/apply-expansion", {
      operationId: randomUUID(),
      previewRef: expansion.value.previewRef,
    });
    const secondAfter = await command("enrollments/list", {
      operationId: randomUUID(),
      accountId: secondHolder,
    });
    expect(
      secondAfter.items.find((item) => item.id === unselected.value.id),
    ).toEqual(secondBefore);
    const expanded = (await ownEnrollments()).find(
      (item) => item.id === first.id,
    );
    expect(expanded).toMatchObject({
      id: first.id,
      startsAt: first.startsAt,
      endsAt: first.endsAt,
    });
    await page.reload();
    await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
    report.scenarios.push(
      "PASS new Guide stays excluded after Offer edit; explicit selected-cohort expansion opens it without changing dates or the unselected holder",
    );
    await send("/access");
    await expect
      .poll(async () =>
        (await messages()).some((message) => message.text.includes("Tribute")),
      )
      .toBe(true);
    let invite;
    await expect
      .poll(
        async () => {
          await send("/community");
          invite = (await messages())
            .map((message) => /https:\/\/t\.me\/\+\S+/u.exec(message.text)?.[0])
            .find(Boolean);
          return Boolean(invite);
        },
        { timeout: 150000, intervals: [5000] },
      )
      .toBe(true);
    await update({
      chat_join_request: {
        chat: { id: -1000000000000, type: "supergroup" },
        from,
        user_chat_id: user,
        date: Math.floor(Date.now() / 1000),
        invite_link: {
          invite_link: invite,
          creator: { id: 1234, is_bot: true, first_name: "SyntheticBot" },
          creates_join_request: true,
          is_primary: false,
          is_revoked: false,
        },
      },
    });
    await expect
      .poll(
        async () =>
          (await (await buyer.request.get(`${telegram}/proof/state`)).json())
            .members[String(user)],
        { timeout: 30000 },
      )
      .toBe("member");
    report.scenarios.push(
      "PASS finite Tribute source authorizes intended community join through actual consumer and Platform dispatch permit",
    );
    await send(`/start a_${report.code}`);
    const replay = await command("tribute/apply", apply);
    expect(replay.value).toEqual(imported.value);
    expect(
      (await ownEnrollments()).filter((item) => item.origin === "tribute"),
    ).toHaveLength(1);
    report.scenarios.push(
      "PASS duplicate link and exact apply receipt preserve one Enrollment and original finite term",
    );
    const expiresAt = new Date(
      Date.parse(endsAt) + 86400000 * 10,
    ).toISOString();
    const event = {
      name: "renewed_subscription",
      created_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      payload: {
        subscription_name: "Synthetic625",
        subscription_id: user,
        period_id: 1,
        period: "monthly",
        price: 10000,
        amount: 9000,
        currency: "rub",
        user_id: user,
        trb_user_id: `T-${String(user)}`,
        telegram_user_id: user,
        channel_id: 625,
        channel_name: "Synthetic",
        expires_at: expiresAt,
        type: "regular",
      },
    };
    async function tributeEvent(document) {
      const raw = JSON.stringify(document);
      const response = await buyer.request.post(
        "http://127.0.0.1:3601/integrations/tribute/v1/webhook",
        {
          headers: {
            "content-type": "application/json",
            "trbt-signature": createHmac("sha256", process.env.TRIBUTE_API_KEY)
              .update(raw)
              .digest("hex"),
          },
          data: raw,
        },
      );
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      return response.json();
    }
    expect((await tributeEvent(event)).status).toBe("applied");
    expect((await tributeEvent(event)).status).toBe("duplicate");
    expect(
      (await ownEnrollments()).find((item) => item.id === first.id).endsAt,
    ).toBe(expiresAt);
    const cancel = {
      ...event,
      name: "cancelled_subscription",
      created_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      payload: { ...event.payload, cancel_reason: "" },
    };
    expect((await tributeEvent(cancel)).status).toBe("applied");
    expect(
      (await ownEnrollments()).find((item) => item.id === first.id),
    ).toMatchObject({ endsAt: expiresAt, state: "active" });
    report.scenarios.push(
      "PASS signed HTTP renewal/dedup/cancel retains exact paid remainder on real account",
    );
    const status = await command("tribute/status", {
      operationId: randomUUID(),
      page: 0,
    });
    const source = status.value.sources.find(
      (item) => item.identityRef === identityRef,
    );
    expect(source).toBeDefined();
    const revoked = await command("tribute/reconcile", {
      operationId: randomUUID(),
      sourceId: source.id,
      expectedRevision: source.revision,
      action: "revoke",
      reason: "Synthetic exact-source revoke acceptance",
    });
    expect(
      (await ownEnrollments()).find((item) => item.id === first.id).state,
    ).toBe("revoked");
    await send(`/start a_${report.code}`);
    const blockedPreview = await command("tribute/preview", {
      operationId: randomUUID(),
      batchRef: `revoked-${String(user)}`,
      rows: [
        {
          ...row,
          checkedAt: new Date().toISOString(),
          endsAt: expiresAt,
          expectedRevision: revoked.value.revision,
        },
      ],
    });
    expect(blockedPreview.value.rows[0].status).toBe("conflict");
    const afterRevoke = {
      ...event,
      created_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
    };
    expect((await tributeEvent(afterRevoke)).status).toBe(
      "pending_reconciliation",
    );
    expect(
      (await ownEnrollments()).find((item) => item.id === first.id).state,
    ).toBe("revoked");
    const restored = await command("tribute/reconcile", {
      operationId: randomUUID(),
      sourceId: source.id,
      expectedRevision: revoked.value.revision,
      action: "restore",
      reason: "Synthetic explicit restoration after verified paid period",
      confirmedTerms: {
        startsAt,
        endsAt: expiresAt,
        verificationRef: `restore-${String(user)}`,
      },
    });
    expect(restored.value.id).toBe(source.id);
    expect(
      (await ownEnrollments()).filter((item) => item.origin === "tribute"),
    ).toHaveLength(1);
    expect(
      (await ownEnrollments()).find((item) => item.id === first.id),
    ).toMatchObject({ state: "active", endsAt: expiresAt });
    report.scenarios.push(
      "PASS actual owner revoke survives bot start/import/signed renewal; explicit restore keeps same source and Enrollment",
    );
    await ownerPage.reload();
    const columns = [
      "rowRef",
      "policyRef",
      "subscriptionId",
      "identityRef",
      "telegramUserId",
      "verificationRef",
      "checkedAt",
      "mode",
      "startsAt",
      "endsAt",
      "renewal",
      "expectedRevision",
      "reason",
    ];
    const csvRow = {
      ...row,
      rowRef: `ui-${String(user)}`,
      endsAt: expiresAt,
      renewal: "stopped",
      checkedAt: new Date().toISOString(),
      expectedRevision: restored.value.revision,
    };
    await ownerPage
      .getByLabel("Название сверки", { exact: true })
      .fill(`ui-recovery-${String(user)}`);
    await ownerPage
      .getByLabel("Содержимое реестра", { exact: true })
      .fill(
        [columns.join(","), columns.map((key) => csvRow[key]).join(",")].join(
          "\n",
        ),
      );
    await ownerPage
      .getByRole("button", { name: "Проверить без применения", exact: true })
      .click();
    await expect(
      ownerPage.getByRole("heading", {
        name: "3. Проверить и применить выбранное",
      }),
    ).toBeVisible();
    await ownerPage
      .getByRole("checkbox", { name: new RegExp(`ui-${String(user)}`, "u") })
      .check();
    await ownerPage.route(
      "**/api/authoring/billing/tribute/apply",
      async (route) => {
        const committed = await route.fetch();
        expect(committed.status()).toBe(200);
        await route.abort("failed");
      },
      { times: 1 },
    );
    await ownerPage
      .getByRole("button", { name: "Применить выбранные строки", exact: true })
      .click();
    await expect(
      ownerPage.getByRole("button", {
        name: "Восстановить результат применения",
        exact: true,
      }),
    ).toBeEnabled();
    await ownerPage
      .getByRole("button", { name: "Проверить без применения", exact: true })
      .click();
    await expect(
      ownerPage.getByText(
        "Сначала восстановите результат предыдущего применения.",
        { exact: true },
      ),
    ).toBeVisible();
    await ownerPage
      .getByRole("button", {
        name: "Восстановить результат применения",
        exact: true,
      })
      .click();
    await expect(
      ownerPage.getByText(/Импорт применён\. Строк: 1/u),
    ).toBeVisible();
    expect(
      (await ownEnrollments()).filter((item) => item.origin === "tribute"),
    ).toHaveLength(1);
    report.scenarios.push(
      "PASS owner CSV preview/select/apply commits through real BFF and restores lost HTTP response without replacing command",
    );
    const purchaseCount = await sql.query(
      "SELECT count(*)::int AS count FROM billing.purchases WHERE account_id=$1",
      [first.accountId],
    );
    expect(purchaseCount.rows[0].count).toBe(0);
    await page.goto(`${web}/account/subscription`);
    await expect(
      page.getByText("Оплачено через Tribute", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.filter(
        (item) => item.impact === "serious" || item.impact === "critical",
      ),
    ).toEqual([]);
    await page.screenshot({
      path: resolve(output, "tribute-account.png"),
      fullPage: true,
    });
    report.evidence.push("tribute-account.png");
    await ownerPage.reload();
    await ownerPage
      .getByText("Источники и восстановление", { exact: true })
      .click();
    const sourceSummary = ownerPage
      .locator("summary")
      .filter({ hasText: identityRef });
    await expect(sourceSummary).toBeVisible();
    await sourceSummary.click();
    await expect(
      ownerPage.getByText(`Источник ${policyRef}`, { exact: false }),
    ).toBeVisible();
    expect(
      await ownerPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await ownerPage
      .getByRole("heading", { name: "Перенос доступа из Tribute" })
      .scrollIntoViewIfNeeded();
    const section = ownerPage
      .getByRole("heading", { name: "Перенос доступа из Tribute" })
      .locator("..");
    await section.screenshot({ path: resolve(output, "tribute-owner.png") });
    report.evidence.push("tribute-owner.png");
    report.scenarios.push(
      "PASS actual account and owner UI; no login/token screenshot persisted",
    );
  }
  await writeFile(
    resolve(output, "acceptance.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  process.stdout.write(
    JSON.stringify({ passed: report.scenarios.length, output }) + "\n",
  );
} finally {
  await browser.close();
  await sql.end();
}
