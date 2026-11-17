import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  handleChangeNotificationPreferences as realChange,
  handleReadNotificationPreferences as realRead,
} from "@/features/notification-preferences.server";

const handleChangeNotificationPreferences = (request: Request) =>
  session(() => realChange(request));
const handleReadNotificationPreferences = () => session(() => realRead());

const operationId = "20000000-0000-4000-8000-000000000001";

function changeRequest(
  input: Record<string, unknown>,
  origin = "https://inside.example.test",
) {
  return new Request(
    "https://inside.example.test/api/account/notifications/preferences/change",
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json", origin },
      method: "POST",
    },
  );
}

beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  session = await realBffSession();
  vi.stubGlobal("fetch", backend);
});

afterEach(() => vi.useRealTimers());

it("отдаёт собственные настройки каналов и закрывает их от кеша", async () => {
  backend.mockResolvedValueOnce(
    Response.json({ revision: 3, email: true, telegram: false }),
  );

  const response = await handleReadNotificationPreferences();

  expect(await response.json()).toEqual({
    ok: true,
    preferences: { revision: 3, email: true, telegram: false },
  });
  expectBackendRequest("GET");
  expect(response.headers.get("cache-control")).toBe("no-store, private");
});

it("сохраняет ожидаемую revision и ссылку на операцию", async () => {
  backend.mockResolvedValueOnce(
    Response.json({
      ok: true,
      preferences: { revision: 4, email: true, telegram: true },
    }),
  );

  const response = await handleChangeNotificationPreferences(
    changeRequest({
      operationId,
      expectedRevision: 3,
      email: true,
      telegram: true,
    }),
  );

  expect(await response.json()).toEqual({
    ok: true,
    preferences: { revision: 4, email: true, telegram: true },
  });
  const sent = expectBackendRequest("POST");
  expect(await sent.json()).toEqual({
    operationId,
    expectedRevision: 3,
    email: true,
    telegram: true,
  });
});

it("возвращает конфликт ревизии как закрытый исход, а не как успех", async () => {
  backend.mockResolvedValueOnce(
    Response.json({ code: "revision_conflict" }, { status: 409 }),
  );

  const response = await handleChangeNotificationPreferences(
    changeRequest({
      operationId,
      expectedRevision: 1,
      email: false,
      telegram: true,
    }),
  );

  expect(await response.json()).toEqual({
    ok: false,
    code: "revision_conflict",
  });
});

it("отклоняет неполную команду до похода в backend", async () => {
  const response = await handleChangeNotificationPreferences(
    changeRequest({ operationId, expectedRevision: 1, email: true }),
  );

  expect(await response.json()).toEqual({ ok: false, code: "invalid_input" });
  expect(backend).not.toHaveBeenCalled();
});

it("не выполняет команду с чужого origin", async () => {
  const response = await handleChangeNotificationPreferences(
    changeRequest(
      {
        operationId,
        expectedRevision: 1,
        email: true,
        telegram: true,
      },
      "https://attacker.example.test",
    ),
  );

  expect(response.status).toBe(403);
  expect(backend).not.toHaveBeenCalled();
});

function expectBackendRequest(method: string): Request {
  expect(backend).toHaveBeenCalledOnce();
  const request = backend.mock.calls[0]?.[0];
  if (request === undefined) throw new Error("Expected backend request");
  expect(request.method).toBe(method);
  expect(request.url).toBe(
    "https://platform-api.example.test/accounts/current/notifications/preferences",
  );
  expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
  return request;
}
