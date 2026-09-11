import { beforeEach, expect, it, vi } from "vitest";
const fakes = vi.hoisted(() => ({
  token: vi.fn(),
  read: vi.fn(),
  change: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestNotificationPreferences: fakes.read,
  requestChangeNotificationPreferences: fakes.change,
}));
vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.token,
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));
import {
  handleChangeNotificationPreferences,
  handleReadNotificationPreferences,
} from "@/features/notification-preferences.server";

const operationId = "20000000-0000-4000-8000-000000000001";

function changeRequest(
  input: Record<string, string>,
  origin = "https://inside.example.test",
) {
  const body = new FormData();
  for (const [key, value] of Object.entries(input)) body.set(key, value);
  return new Request(
    "https://inside.example.test/api/account/notifications/preferences/change",
    { body, headers: { origin }, method: "POST" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("trusted-token");
});

it("отдаёт собственные настройки каналов и закрывает их от кеша", async () => {
  fakes.read.mockResolvedValue({
    ok: true,
    body: { revision: 3, email: true, telegram: false },
    response: new Response(),
  });

  const response = await handleReadNotificationPreferences();

  expect(await response.json()).toEqual({
    ok: true,
    preferences: { revision: 3, email: true, telegram: false },
  });
  expect(fakes.read).toHaveBeenCalledWith("trusted-token");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("сохраняет ожидаемую revision и ссылку на операцию", async () => {
  fakes.change.mockResolvedValue({
    ok: true,
    body: { ok: true, preferences: { revision: 4, email: true, telegram: true } },
    response: new Response(),
  });

  const response = await handleChangeNotificationPreferences(
    changeRequest({
      operationId,
      expectedRevision: "3",
      email: "true",
      telegram: "true",
    }),
  );

  expect(await response.json()).toEqual({
    ok: true,
    preferences: { revision: 4, email: true, telegram: true },
  });
  expect(fakes.change).toHaveBeenCalledWith(
    { operationId, expectedRevision: 3, email: true, telegram: true },
    "trusted-token",
  );
});

it("возвращает конфликт ревизии как закрытый исход, а не как успех", async () => {
  fakes.change.mockResolvedValue({
    ok: false,
    problem: { code: "revision_conflict" },
    response: new Response(null, { status: 409 }),
  });

  const response = await handleChangeNotificationPreferences(
    changeRequest({
      operationId,
      expectedRevision: "1",
      email: "false",
      telegram: "true",
    }),
  );

  expect(await response.json()).toEqual({
    ok: false,
    code: "revision_conflict",
  });
});

it("отклоняет неполную команду до похода в backend", async () => {
  const response = await handleChangeNotificationPreferences(
    changeRequest({ operationId, expectedRevision: "1", email: "true" }),
  );

  expect(await response.json()).toEqual({ ok: false, code: "invalid_input" });
  expect(fakes.change).not.toHaveBeenCalled();
});

it("не выполняет команду с чужого origin", async () => {
  const response = await handleChangeNotificationPreferences(
    changeRequest(
      {
        operationId,
        expectedRevision: "1",
        email: "true",
        telegram: "true",
      },
      "https://attacker.example.test",
    ),
  );

  expect(response.status).toBe(403);
  expect(fakes.change).not.toHaveBeenCalled();
});
