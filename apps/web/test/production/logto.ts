import { Buffer } from "node:buffer";

import { z } from "zod";

import { productionTarget } from "./pass-config";

/**
 * Вход тестовых identities без владельца (#905). Единственный долгоживущий секрет — ключ
 * M2M-приложения Logto из окружения GitHub `Production`. Он даёт токен Management API, через который
 * проход выпускает one-time token для браузерного входа и PAT для API на время прогона. Тот же
 * M2M-клиент обменивает PAT на короткий токен Platform API (token exchange).
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
const patsSchema = z.array(z.object({ name: z.string() }));
const requestTimeoutMs = 20_000;
/** PAT живёт не дольше прогона, даже если удаление после прогона не дошло. */
const patLifetimeMs = 30 * 60_000;
const oneTimeTokenLifetimeSeconds = 600;
/** Имя PAT прохода; хвост — номер прогона. По префиксу проход удаляет остатки прошлых прогонов. */
export const passPatPrefix = "inside-production-access-";

export interface LogtoPassClient {
  findUserId(email: string): Promise<string>;
  issueOneTimeToken(email: string): Promise<string>;
  /** Выпускает PAT на прогон, обменивает его и возвращает короткий токен Platform API. */
  platformAccessToken(userId: string, runId: string): Promise<string>;
  /** Удаляет PAT прохода у identity; возвращает число удалённых. */
  deletePassTokens(userId: string): Promise<number>;
}

/**
 * В GitHub Actions значение скрывается во всех следующих строках лога: Playwright печатает URL входа
 * с one-time token и email identity, когда шаг падает.
 */
export function masked(value: string): string {
  if (process.env["GITHUB_ACTIONS"] === "true") {
    process.stdout.write(`::add-mask::${value}\n`);
  }
  return value;
}

export function readLogtoCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): { readonly appId: string; readonly appSecret: string } | undefined {
  const parsed = credentialsSchema.safeParse(environment);
  return parsed.success
    ? {
        appId: parsed.data.PRODUCTION_ACCESS_LOGTO_APP_ID,
        appSecret: parsed.data.PRODUCTION_ACCESS_LOGTO_APP_SECRET,
      }
    : undefined;
}

export async function createLogtoPassClient(credentials: {
  readonly appId: string;
  readonly appSecret: string;
}): Promise<LogtoPassClient> {
  const basic = `Basic ${Buffer.from(`${credentials.appId}:${credentials.appSecret}`).toString("base64")}`;
  const token = async (body: Record<string, string>) => {
    const response = await fetch(`${productionTarget.logto}/oidc/token`, {
      method: "POST",
      headers: {
        authorization: basic,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) {
      // Тело ответа Logto не попадает в лог: в нём может оказаться отражённый ввод.
      throw new Error(
        `Logto token request ${body["grant_type"] ?? ""} failed: ${String(response.status)}`,
      );
    }
    return masked(tokenSchema.parse(await response.json()).access_token);
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
    const response = await fetch(`${productionTarget.logto}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${management}`,
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(requestTimeoutMs),
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
      masked(email);
      masked(encodeURIComponent(email));
      return masked(
        z.object({ token: z.string().min(1) }).parse(
          await api("/one-time-tokens", {
            method: "POST",
            body: { email, expiresIn: oneTimeTokenLifetimeSeconds },
          }),
        ).token,
      );
    },
    async platformAccessToken(userId, runId) {
      const name = `${passPatPrefix}${runId}`;
      const pat = z.object({ value: z.string().min(1) }).parse(
        await api(tokensPath(userId), {
          method: "POST",
          body: { name, expiresAt: Date.now() + patLifetimeMs },
        }),
      );
      return token({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: masked(pat.value),
        subject_token_type: "urn:logto:token-type:personal_access_token",
        resource: productionTarget.apiResource,
      });
    },
    async deletePassTokens(userId) {
      const names = patsSchema
        .parse(await api(tokensPath(userId)))
        .map(({ name }) => name)
        .filter((name) => name.startsWith(passPatPrefix));
      for (const name of names) {
        await api(`${tokensPath(userId)}/${encodeURIComponent(name)}`, {
          method: "DELETE",
        });
      }
      return names.length;
    },
  };
}
