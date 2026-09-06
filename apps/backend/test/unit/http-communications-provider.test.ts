import { expect, test, vi } from "vitest";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { requestSchema } from "../../src/modules/communications/communications-schema.generated.js";
import { HttpCommunicationsProvider } from "../../src/modules/communications/infrastructure/http-communications-provider.js";

const config = parsePlatformConfig({ NODE_ENV: "test", TELEGRAM_COMMUNICATIONS_ENDPOINT: "http://127.0.0.1:9876/integrations/platform/v1/communications", TELEGRAM_COMMUNICATIONS_SECRET: "synthetic-communications-secret", TELEGRAM_AUTHOR_AUTHORIZATION_SECRET: "synthetic-authorization-secret", TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: "synthetic-bot" }).communications;
const request = requestSchema.parse({ contractVersion: "inside-communications-v1", operation: "templates.read", operationId: "11111111-1111-4111-8111-111111111111", expectedRevision: 0, actor: { accountRef: "synthetic-owner" }, payload: { templateId: "22222222-2222-4222-8222-222222222222" } });
const success = { contractVersion: "inside-communications-v1", status: "ok", template: { templateId: "22222222-2222-4222-8222-222222222222", revision: 1, botIdentity: "synthetic-bot", content: { type: "text", text: "Synthetic", entities: [], buttons: [] } } };

test("provider preserves the complete envelope on explicit retries", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(Response.json(success)));
  const provider = new HttpCommunicationsProvider(config, fetcher);
  await expect(provider.execute(request)).resolves.toEqual({ ok: true, value: success });
  await provider.execute(request);
  for (const call of fetcher.mock.calls) {
    expect(call[1]?.body).toBe(JSON.stringify(request));
    expect(call[1]?.redirect).toBe("error");
    expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
  }
});

test.each([
  [409, { contractVersion: "inside-communications-v1", status: "revision_conflict" }, "revision_conflict"],
  [409, { contractVersion: "inside-communications-v1", status: "operation_conflict" }, "operation_conflict"],
  [501, { contractVersion: "inside-communications-v1", status: "not_implemented" }, "not_implemented"],
  [503, { contractVersion: "inside-communications-v1", status: "authorization_unavailable" }, "authorization_unavailable"],
  [200, { ...success, template: { ...success.template, botIdentity: "foreign-bot" } }, "provider_invalid_response"],
  [200, { ...success, template: { ...success.template, content: { ...success.template.content, text: "https://api.telegram.org/file/botSECRET/document" } } }, "provider_invalid_response"],
  [200, { status: "ok" }, "provider_invalid_response"],
  [503, success, "provider_invalid_response"],
  [200, { ...success, template: { ...success.template, templateId: "33333333-3333-4333-8333-333333333333" } }, "provider_invalid_response"],
  [200, { contractVersion: "inside-communications-v1", status: "ok", testDeliveryId: "33333333-3333-4333-8333-333333333333" }, "provider_invalid_response"],
] as const)("maps status %s without fictitious success", async (status, body, code) => {
  const provider = new HttpCommunicationsProvider(config, () => Promise.resolve(Response.json(body, { status })));
  await expect(provider.execute(request)).resolves.toEqual({ ok: false, error: { code } });
});

test("an uncertain transport is not retried automatically", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("lost reply"));
  await expect(new HttpCommunicationsProvider(config, fetcher).execute(request)).resolves.toEqual({ ok: false, error: { code: "provider_unavailable" } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(new HttpCommunicationsProvider(undefined, fetcher).execute(request)).resolves.toEqual({ ok: false, error: { code: "provider_unavailable" } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("configuration is opt-in, complete, credential-free in URLs and fails closed", () => {
  expect(parsePlatformConfig({ NODE_ENV: "test" }).communications).toBeUndefined();
  expect(() => parsePlatformConfig({ NODE_ENV: "test", TELEGRAM_COMMUNICATIONS_ENDPOINT: "https://example.test" })).toThrow();
});

test("ordinary mentions of the Telegram API domain remain author content", async () => {
  const value = { ...success, template: { ...success.template, content: { ...success.template.content, text: "Запрос отправляется на api.telegram.org" } } };
  const provider = new HttpCommunicationsProvider(config, () => Promise.resolve(Response.json(value)));
  await expect(provider.execute(request)).resolves.toEqual({ ok: true, value });
});

test("canonical UUID response spelling does not change the caller's retry envelope", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const input = requestSchema.parse({ ...request, payload: { templateId: id.toUpperCase() } });
  const value = { ...success, template: { ...success.template, templateId: id } };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(Response.json(value)));
  await expect(new HttpCommunicationsProvider(config, fetcher).execute(input)).resolves.toEqual({ ok: true, value });
  expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(input));
});
