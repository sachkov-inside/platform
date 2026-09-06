import type {
  Broadcast,
  Contact,
  Funnel,
  Part,
  StatisticsResult,
} from "../model/broadcasts";

const firstSourceId = "10000000-0000-4000-8000-000000000006";
const latestSourceId = "10000000-0000-4000-8000-000000000007";
export const funnelFixture: Funnel = {
  funnelId: "10000000-0000-4000-8000-000000000003",
  name: "Инженерная практика",
  sources: [
    { sourceId: firstSourceId, name: "Разбор на YouTube", code: "m_youtube" },
    { sourceId: latestSourceId, name: "Канал Inside", code: "m_channel" },
  ],
};
export const broadcastFixture: Broadcast = {
  broadcastId: "10000000-0000-4000-8000-000000000001",
  revision: 1,
  state: "draft",
  parts: [
    {
      partId: "10000000-0000-4000-8000-000000000002",
      content: {
        type: "text",
        text: "Почему очередь не спасает от потери сообщений?\n\nРазобрали случай: сервис сохранил заказ, но упал до отправки события. В новом материале — как outbox закрывает этот разрыв и где всё ещё нужны повторы.\n\nЧитайте разбор и попробуйте воспроизвести сбой сами.",
        entities: [],
        buttons: [
          {
            text: "Открыть разбор",
            url: "https://inside.test/materials/outbox",
          },
        ],
      },
    },
  ],
  audience: { kind: "all" },
  scheduledAt: null,
  audienceSnapshotId: null,
  snapshotSize: 0,
};
export const mediaFixture: Part = {
  partId: "10000000-0000-4000-8000-000000000010",
  content: {
    type: "video_note",
    fileId: "synthetic-video-note",
    text: "",
    entities: [],
    buttons: [],
  },
};
export const contactFixture: Contact = {
  contactId: "10000000-0000-4000-8000-000000000008",
  reachable: true,
  marketingEnabled: true,
  firstSourceId: firstSourceId,
  latestSourceId: latestSourceId,
  entries: [
    {
      sourceId: firstSourceId,
      sourceCode: "m_youtube",
      funnelId: funnelFixture.funnelId,
      enteredAt: "2026-09-01T10:00:00Z",
      outcome: "entered",
    },
    {
      sourceId: latestSourceId,
      sourceCode: "m_channel",
      funnelId: funnelFixture.funnelId,
      enteredAt: "2026-09-05T15:30:00Z",
      outcome: "entered",
    },
  ],
  nextEntryCursor: null,
};
export const statisticsFixture = {
  kind: "ready",
  trackingBacklog: { kind: "ready", pending: 3, oldestAgeSeconds: 120 },
  statistics: {
    totalBotContacts: 1420,
    reachable: 1300,
    blocked: 120,
    marketingOff: 200,
    uniqueParticipants: 1100,
    deliveries: {
      sent: 840,
      suppressed: 25,
      failed: 1,
      unknown: 2,
      partialCancelled: 1,
      pending: 32,
    },
    trackingHits: 234,
    uniqueTokensWithHits: 121,
    knownAutomationHits: 15,
    analyticsLagSeconds: 30,
    contacts: [contactFixture],
    nextCursor: "contacts-page-2",
  },
} satisfies StatisticsResult;
