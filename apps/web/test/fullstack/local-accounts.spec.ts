import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  fullStackBaseUrl,
  signInFullStack,
} from "../support/full-stack-session";

test("local accounts: fresh owner, private draft and real denials survive restart and isolated contexts", async ({
  browser,
}) => {
  const { startLocalAccountsGateway } =
    await import("../../../../scripts/local-accounts-gateway.mjs");
  const ownerContext = await browser.newContext();
  let gateway:
    Awaited<ReturnType<typeof startLocalAccountsGateway>> | undefined;
  const context = await browser.newContext();
  try {
    await signInFullStack(ownerContext, "OWNER");
    const created = await ownerContext.request.post(
      `${fullStackBaseUrl()}/api/authoring/materials`,
      {
        headers: { origin: fullStackBaseUrl() },
        form: {
          title: "Local account private draft",
          summary: "",
          access: "free",
          difficulty: "unassigned",
          formatId: "unassigned",
          topicId: "unassigned",
          seriesIds: "[]",
          submissionId: randomUUID(),
          document: JSON.stringify({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "LOCAL_ACCOUNT_PRIVATE_DRAFT" },
                ],
              },
            ],
          }),
        },
      },
    );
    const draft = z
      .object({
        kind: z.literal("created"),
        draft: z.object({ materialId: z.uuid() }),
      })
      .parse(await created.json());
    const sessions: Record<string, string | undefined> = {
      owner: process.env["FULLSTACK_LOGTO_SESSION"],
      learner: process.env["FULLSTACK_LOGTO_LOCAL_LEARNER_SESSION"],
      "learner-with-access":
        process.env["FULLSTACK_LOGTO_LOCAL_LEARNER_WITH_ACCESS_SESSION"],
    };
    gateway = await startLocalAccountsGateway({
      port: 0,
      upstream: fullStackBaseUrl(),
      cookieName: z.string().parse(process.env["FULLSTACK_LOGTO_COOKIE_NAME"]),
      secret: "local-accounts-browser-proof-cookie-secret",
      createSession: (choice) =>
        Promise.resolve(z.string().parse(sessions[choice])),
    });
    const origin = gateway.origin;
    const page = await context.newPage();
    const preview = `/authoring/materials/${draft.draft.materialId}/preview`;
    await page.goto(`${origin}${preview}`);
    await expect(
      page.getByText("LOCAL_ACCOUNT_PRIVATE_DRAFT", { exact: true }),
    ).toBeVisible();
    const ownerStatus: unknown = await (
      await context.request.get(`${origin}/auth/status`)
    ).json();
    expect(ownerStatus).toMatchObject({
      state: "authenticated",
      canManageMaterials: true,
    });
    const ids = new Set<string>();
    for (const [choice, label] of [
      ["learner-with-access", "Ученик с доступом"],
      ["learner", "Ученик без доступа"],
      ["guest", "Гость"],
      ["owner", "Владелец"],
    ] as const) {
      await page.goto(
        `${origin}/__local/accounts?returnTo=${encodeURIComponent(preview)}`,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.getByRole("radio", { name: new RegExp(`^${label}`) }).check();
      await page.getByRole("button", { name: "Выбрать аккаунт" }).click();
      await page.reload();
      const state = z
        .object({
          state: z.string(),
          canManageMaterials: z.boolean(),
          accountId: z.string().nullable(),
        })
        .parse(
          await (await context.request.get(`${origin}/auth/status`)).json(),
        );
      expect(state.canManageMaterials).toBe(choice === "owner");
      expect(state.state).toBe(choice === "guest" ? "guest" : "authenticated");
      if (choice.startsWith("learner"))
        ids.add(z.string().parse(state.accountId));
      const authoring = await context.request.get(
        `${origin}/api/authoring/materials`,
      );
      expect(authoring.status()).toBe(
        choice === "owner" ? 200 : choice === "guest" ? 401 : 403,
      );
      if (choice !== "owner")
        await expect(
          page.getByText("LOCAL_ACCOUNT_PRIVATE_DRAFT", { exact: true }),
        ).toHaveCount(0);
      if (choice === "guest") {
        await gateway.close();
        gateway = await startLocalAccountsGateway({
          port: Number(new URL(origin).port),
          upstream: fullStackBaseUrl(),
          cookieName: z
            .string()
            .parse(process.env["FULLSTACK_LOGTO_COOKIE_NAME"]),
          secret: "local-accounts-browser-proof-cookie-secret",
          createSession: (profile) =>
            Promise.resolve(z.string().parse(sessions[profile])),
        });
        await page.reload();
        expect(
          await (await context.request.get(`${origin}/auth/status`)).json(),
        ).toMatchObject({ state: "guest", canManageMaterials: false });
        const fresh = await browser.newContext();
        try {
          expect(
            await (await fresh.request.get(`${origin}/auth/status`)).json(),
          ).toMatchObject({ state: "authenticated", canManageMaterials: true });
        } finally {
          await fresh.close();
        }
      }
      await page.goto(
        `${origin}/materials/developer-pipeline-bez-poteri-konteksta`,
      );
      await expect(
        page.getByText("Закрытое содержимое для участников.", { exact: true }),
      ).toHaveCount(
        choice === "owner" || choice === "learner-with-access" ? 1 : 0,
      );
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth ===
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
    expect(ids.size).toBe(2);
    await page.goto(`${origin}${preview}`);
    await expect(
      page.getByText("LOCAL_ACCOUNT_PRIVATE_DRAFT", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
    await ownerContext.close();
    await gateway?.close();
  }
});
