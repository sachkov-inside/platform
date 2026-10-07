import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { TelegramLinkState } from "@/features/account-access/model/account-telegram-membership";
import {
  clearTelegramLinkSession,
  resolveTelegramLinkDeepLink,
} from "@/features/account-access/model/telegram-link-session.browser";

const sessionKey = "inside.telegram-link.v1";
const deepLink = "https://t.me/inside_test_bot?start=opaque";
const pending: TelegramLinkState = {
  expiresAt: "2030-01-01T00:05:00.000Z",
  linkRef: "62000000-0000-4000-8000-000000000001",
  status: "pending",
};
let stored: string | null;

beforeEach(() => {
  stored = null;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: () => stored,
      removeItem: () => {
        stored = null;
      },
      setItem: (key: string, value: string) => {
        expect(key).toBe(sessionKey);
        stored = value;
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("восстанавливает код только после ответа сервера о той же ожидающей привязке", () => {
  expect(resolveTelegramLinkDeepLink({ ...pending, deepLink })).toBe(deepLink);
  expect(resolveTelegramLinkDeepLink(pending)).toBe(deepLink);
});

test.each([
  { linkRef: "62000000-0000-4000-8000-000000000002" },
  { expiresAt: "2030-01-01T00:06:00.000Z" },
])("отбрасывает код при несовпадении привязки или срока: %j", (change) => {
  resolveTelegramLinkDeepLink({ ...pending, deepLink });
  expect(resolveTelegramLinkDeepLink({ ...pending, ...change })).toBeNull();
  expect(stored).toBeNull();
});

test.each([
  "linked",
  "expired",
  "replayed",
  "conflict",
  "recovery-required",
  "unavailable",
] as const)("отбрасывает код после серверного статуса %s", (status) => {
  resolveTelegramLinkDeepLink({ ...pending, deepLink });
  expect(resolveTelegramLinkDeepLink({ ...pending, status })).toBeNull();
  expect(stored).toBeNull();
});

test("не открывает код на границе срока, даже если сервер ещё ответил pending", () => {
  resolveTelegramLinkDeepLink({ ...pending, deepLink });
  vi.setSystemTime(new Date(pending.expiresAt));
  expect(resolveTelegramLinkDeepLink(pending)).toBeNull();
  expect(resolveTelegramLinkDeepLink({ ...pending, deepLink })).toBeNull();
  expect(stored).toBeNull();
});

test.each([
  "{",
  JSON.stringify({ ...pending, deepLink }),
  JSON.stringify({
    ...pending,
    status: undefined,
    deepLink: "https://example.com/?start=opaque",
  }),
  JSON.stringify({
    ...pending,
    status: undefined,
    deepLink: "javascript:alert(1)",
  }),
  JSON.stringify({
    ...pending,
    status: undefined,
    deepLink: "https://t.me/inside_test_bot?start=",
  }),
  JSON.stringify({
    ...pending,
    status: undefined,
    deepLink: "https://t.me/?start=opaque",
  }),
])(
  "повреждённая запись или чужой адрес не заменяют ссылку от сервера: %s",
  (raw) => {
    stored = raw;
    expect(resolveTelegramLinkDeepLink(pending)).toBeNull();
    expect(stored).toBeNull();
  },
);

test("без browser storage открывает новую ссылку и безопасно отказывает повтору без кода", () => {
  vi.stubGlobal("window", {
    get sessionStorage() {
      throw new DOMException("Storage denied", "SecurityError");
    },
  });
  expect(resolveTelegramLinkDeepLink({ ...pending, deepLink })).toBe(deepLink);
  expect(resolveTelegramLinkDeepLink(pending)).toBeNull();
  expect(() => {
    clearTelegramLinkSession();
  }).not.toThrow();
});

test("удаляет сохранённый код после завершения сессии", () => {
  resolveTelegramLinkDeepLink({ ...pending, deepLink });
  clearTelegramLinkSession();
  expect(resolveTelegramLinkDeepLink(pending)).toBeNull();
});
