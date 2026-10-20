import { expect, test, vi } from "vitest";
import { HttpMaterialAnnouncementsAdapter } from "../../src/adapters/platform/http-material-announcements.adapter.js";
import { materialAnnouncementContent } from "../../src/modules/communications/material-announcements.js";
import { materialAnnouncementSchema } from "@inside/contracts/material-announcements";
const item = materialAnnouncementSchema.parse({
  announcementRef: "71000000-0000-4000-8000-000000000001",
  materialId: "71000000-0000-4000-8000-000000000002",
  title: "🦊 <b>Буквальный заголовок</b>",
  summary: "Описание & ссылка https://other.example",
  url: "https://inside.example/materials/sample",
  occurredAt: "2030-01-01T00:00:00Z",
  notAfter: "2030-01-02T00:00:00Z",
});
test("plain author text retains UTF-16 entity boundaries and an explicit canonical reader link", () => {
  const content = materialAnnouncementContent(item);
  const entity = content.entities[0];
  expect(content.text).toContain(item.summary);
  expect(
    content.text.slice(
      entity?.offset,
      (entity?.offset ?? 0) + (entity?.length ?? 0),
    ),
  ).toBe(item.title);
  expect(content.buttons).toEqual([
    { text: "Открыть материал", url: item.url },
  ]);
});
test("source adapter distinguishes outage from exhaustion and refuses malformed or redirected responses", async () => {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json({ items: [item], nextCursor: null })),
  );
  const adapter = new HttpMaterialAnnouncementsAdapter(
    "https://platform.example/integrations/telegram/v1/communications/authorize",
    "synthetic-secret",
    fetcher,
  );
  expect((await adapter.read({}))?.items).toEqual([item]);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    "https://platform.example/integrations/telegram/v1/communications/materials",
  );
  const init = fetcher.mock.calls[0]?.[1];
  expect(init?.redirect).toBe("error");
  expect(new Headers(init?.headers).get("authorization")).toBe(
    "Bearer synthetic-secret",
  );
  fetcher.mockResolvedValue(Response.json({ items: [], nextCursor: null }));
  expect(await adapter.read({})).toEqual({ items: [], nextCursor: null });
  fetcher.mockResolvedValue(
    Response.json({
      items: [{ ...item, url: "file:///private" }],
      nextCursor: null,
    }),
  );
  expect(await adapter.read({})).toBeNull();
  fetcher.mockResolvedValue(Response.json({}, { status: 503 }));
  expect(await adapter.read({})).toBeNull();
});
