import { Buffer } from "node:buffer";

import { z } from "zod";

import { productionTarget } from "./pass-config";
import { passFetch, passPatPrefix } from "./pass-requests";

/**
 * Вход тестовых identities без владельца (#905). Единственный долгоживущий секрет — ключ
 * M2M-приложения Logto из окружения GitHub `Production`. Он даёт токен Management API, через
 * который проход выпускает one-time token для браузерного входа и PAT для API на время прогона. Тот
 * же M2M-клиент обменивает PAT на короткий токен Platform API (token exchange). Каждый запрос
 * проходит allowlist прохода (`pass-requests.ts`).
 */
const credentialsSchema = z.object({
  PRODUCTION_ACCESS_LOGTO_APP_ID: z.string().min(1),
  PRODUCTION_ACCESS_LOGTO_APP_SECRET: z.string().min(1),
});
const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});
const usersSchema = z.array(
  z.object({ id: z.string(), primaryEmail: z.string().nullable() }),
);
const patsSchema = z.array(
  z.object({ name: z.string(), expiresAt: z.number().nullable() }),
);
/** PAT живёт не дольше прогона, даже если удаление после прогона не дошло. */
const patLifetimeMs = 30 * 60_000;
const oneTimeTokenLifetimeSeconds = 600;
/** Имя PAT прохода; хвост — номер прогона. */
const passPatName = (runId: string) => `${passPatPrefix}${runId}`;

export interface LogtoCredentials {
  readonly appId: string;
  readonly appSecret: string;
}

export interface LogtoPassClient {
  findUserId(email: string): Promise<string>;
  issueOneTimeToken(email: string): Promise<string>;
  /**
   * Выпускает PAT на прогон и обменивает его на два коротких токена: Platform API и учебного MCP.
   * Учебный MCP принимает только токен своего ресурса со scope `learning:read`.
   */
  accessTokens(
    userId: string,
    runId: string,
  ): Promise<{ readonly api: string; readonly learner: string }>;
  /**
   * Удаляет PAT этого прогона и истёкшие PAT прошлых. Действующий PAT другого прогона остаётся:
   * параллельный прогон не теряет свой вход.
   */
  deletePassTokens(userId: string, runId: string): Promise<void>;
}

/**
 * Регистрирует значение как секрет лога GitHub Actions и возвращает его без изменений: Playwright
 * печатает URL входа с one-time token и email identity, когда шаг падает. Отчёт прохода скрывает
 * те же значения.
 */
const logSecrets = new Set<string>();

export function registerLogSecret(value: string): string {
  logSecrets.add(value);
  if (process.env["GITHUB_ACTIONS"] === "true") {
    process.stdout.write(`::add-mask::${value}\n`);
  }
  return value;
}

/** Значения, которые процесс прохода скрыл в логе; отчёт скрывает их тоже. */
export function registeredLogSecrets(): readonly string[] {
  return [...logSecrets];
}

export function readLogtoCredentials(): LogtoCredentials | undefined {
  const parsed = credentialsSchema.safeParse(process.env);
  return parsed.success
    ? {
        appId: parsed.data.PRODUCTION_ACCESS_LOGTO_APP_ID,
        appSecret: parsed.data.PRODUCTION_ACCESS_LOGTO_APP_SECRET,
      }
    : undefined;
}

export async function createLogtoPassClient(
  credentials: LogtoCredentials,
): Promise<LogtoPassClient> {
  const basic = `Basic ${Buffer.from(`${credentials.appId}:${credentials.appSecret}`).toString("base64")}`;
  const token = async (body: Record<string, string>) => {
    const response = await passFetch(`${productionTarget.logto}/oidc/token`, {
      method: "POST",
      headers: {
        authorization: basic,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    });
    if (!response.ok) {
      // Тело ответа Logto не попадает в лог: в нём может оказаться отражённый ввод.
      throw new Error(
        `Logto token request ${body["grant_type"] ?? ""} failed: ${String(response.status)}`,
      );
    }
    return registerLogSecret(
      tokenSchema.parse(await response.json()).access_token,
    );
  };
  const management = await token({
    grant_type: "client_credentials",
    resource: productionTarget.managementResource,
    scope: "all",
  });
  const api = async (
    path: string,
    init: { readonly method?: string; readonly body?: unknown } = {},
  ): Promise<unknown> => {
    const method = init.method ?? "GET";
    const response = await passFetch(`${productionTarget.logto}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${management}`,
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (!response.ok) {
      throw new Error(
        `Logto Management API ${method} ${path.split("?")[0] ?? ""} failed: ${String(response.status)}`,
      );
    }
    const text = await response.text();
    return text.length === 0 ? null : (JSON.parse(text) as unknown);
  };
  const tokensPath = (userId: string) =>
    `/users/${encodeURIComponent(userId)}/personal-access-tokens`;

  return {
    async findUserId(email) {
      const users = usersSchema
        .parse(await api(`/users?search=${encodeURIComponent(email)}`))
        .filter(
          (user) => user.primaryEmail?.toLowerCase() === email.toLowerCase(),
        );
      const [user] = users;
      if (users.length !== 1 || user === undefined) {
        throw new Error(`Test identity is missing in Logto`);
      }
      return user.id;
    },
    async issueOneTimeToken(email) {
      return registerLogSecret(
        z.object({ token: z.string().min(1) }).parse(
          await api("/one-time-tokens", {
            method: "POST",
            body: { email, expiresIn: oneTimeTokenLifetimeSeconds },
          }),
        ).token,
      );
    },
    async accessTokens(userId, runId) {
      const name = passPatName(runId);
      const pat = z.object({ value: z.string().min(1) }).parse(
        await api(tokensPath(userId), {
          method: "POST",
          // deterministic-test-allow wall-clock: Legacy clock read; fixed domain or monotonic clock migration is tracked in #1177.
          body: { name, expiresAt: Date.now() + patLifetimeMs },
        }),
      );
      const exchange = (resource: string, scope?: string) =>
        token({
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          subject_token: registerLogSecret(pat.value),
          subject_token_type: "urn:logto:token-type:personal_access_token",
          resource,
          ...(scope === undefined ? {} : { scope }),
        });
      return {
        api: await exchange(productionTarget.apiResource),
        learner: await exchange(productionTarget.learnerMcp, "learning:read"),
      };
    },
    async deletePassTokens(userId, runId) {
      const own = passPatName(runId);
      const names = patsSchema
        .parse(await api(tokensPath(userId)))
        .filter(
          ({ name, expiresAt }) =>
            name === own ||
            (name.startsWith(passPatPrefix) &&
              expiresAt !== null &&
              // deterministic-test-allow wall-clock: Legacy clock read; fixed domain or monotonic clock migration is tracked in #1177.
              expiresAt <= Date.now()),
        )
        .map(({ name }) => name);
      for (const name of names) {
        await api(`${tokensPath(userId)}/${encodeURIComponent(name)}`, {
          method: "DELETE",
        });
      }
    },
  };
}
