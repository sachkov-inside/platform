import { expect, it, vi } from "vitest";
import { GrammyContactProfileAdapter } from "../../src/adapters/telegram/grammy-contact-profile.adapter.js";
it("accepts only the requested private Telegram chat and tolerates an absent username", async () => {
  const getChat = vi.fn().mockResolvedValue({
    id: 42,
    type: "private",
    first_name: "Анна",
    last_name: "Смирнова",
    username: "anna_example",
  });
  const adapter = new GrammyContactProfileAdapter("synthetic", { getChat });
  const signal = new AbortController().signal;
  expect(await adapter.read("42", signal)).toEqual({
    kind: "available",
    displayName: "Анна Смирнова",
    username: "anna_example",
  });
  getChat.mockResolvedValueOnce({
    id: 42,
    type: "private",
    first_name: "Анна",
  });
  expect(await adapter.read("42", signal)).toEqual({
    kind: "available",
    displayName: "Анна",
    username: null,
  });
  for (const value of [
    { id: 43, type: "private", first_name: "Другой" },
    { id: 42, type: "group", first_name: "Группа" },
  ]) {
    getChat.mockResolvedValueOnce(value);
    expect(await adapter.read("42", signal)).toEqual({ kind: "unavailable" });
  }
  const aborted = new AbortController();
  aborted.abort();
  const calls = getChat.mock.calls.length;
  expect(await adapter.read("42", aborted.signal)).toEqual({
    kind: "unavailable",
  });
  expect(getChat).toHaveBeenCalledTimes(calls);
});
it("bridges the batch cancellation to the Telegram SDK signal", async () => {
  const controller = new AbortController();
  const api = {
    getChat: vi.fn((_id: number, signal?: { readonly aborted: boolean }) => {
      controller.abort();
      expect(signal?.aborted).toBe(true);
      return Promise.resolve({ id: 42, type: "private", first_name: "Анна" });
    }),
  };
  const adapter = new GrammyContactProfileAdapter("synthetic", api);
  expect(await adapter.read("42", controller.signal)).toEqual({
    kind: "available",
    displayName: "Анна",
    username: null,
  });
});
