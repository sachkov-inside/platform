// @ts-check
/** Fictional people shared by owner stories and navigation adapters. */
export const peopleScenario = {
  anna: {
    displayName: "Анна Петрова",
    username: "anna_petrova",
    email: "anna.petrova@example.test",
    contactsState: "complete",
  },
  konstantin: {
    displayName: "Константин Константинопольский-Задунайский",
    username: null,
    email: "konstantin.zadunaisky.long.address@example.test",
    contactsState: "complete",
  },
  newcomer: {
    displayName: null,
    username: null,
    email: "buyer.only@example.test",
    contactsState: "partial",
  },
  directoryNames: [
    "Мария Соколова",
    "Дмитрий Иванов",
    "Елена Кузнецова",
    "Алексей Смирнов",
    "Ольга Попова",
    "Сергей Васильев",
  ],
  paymentBuyerNames: ["Мария Иванова", "Илья Кузнецов"],
  products: [
    {
      name: "AI Engineering: агенты в работе",
      longName: "AI Engineering: агенты в работе",
      archived: false,
    },
    {
      name: "Архитектура приложения",
      longName: "Архитектура приложения и проектирование распределённых систем",
      archived: false,
    },
    {
      name: "Инженерная практика",
      longName: "Инженерная практика",
      archived: false,
    },
    {
      name: "Агенты для команды (поток 2025)",
      longName: "Агенты для команды (поток 2025)",
      archived: true,
    },
  ],
};

/** Fixed directory epochs; adapters retain their own populations and index offsets. */
export const peopleDirectoryScenario = {
  registeredEpoch: "2026-10-20T09:00:00.000Z",
  activityEpoch: "2026-10-26T15:00:00.000Z",
};

/** The shared default access-history example, not the older restored-access variant. */
export const peopleHistoryScenario = {
  issuedAt: "2026-09-02T08:15:00.000Z",
  revoke: {
    at: "2026-10-01T12:40:00.000Z",
    reason: "Возврат оплаты",
  },
};

/** Anna's populated card. Physical preview IDs and older manual history stay in each adapter. */
export const peopleCardScenario = {
  registeredAt: "2026-09-02T08:00:00.000Z",
  lastActivityAt: "2026-10-26T18:20:00.000Z",
  paidAccess: { access: "active", revision: 1, origin: "paid" },
  payments: [
    {
      amountKopecks: 1_499_000,
      state: "confirmed",
      createdAt: "2026-09-02T08:14:00.000Z",
    },
    {
      amountKopecks: 990_000,
      state: "failed",
      createdAt: "2026-08-28T19:02:00.000Z",
    },
  ],
  learning: {
    startedAt: "2026-09-03T10:00:00.000Z",
    read: 12,
    total: 40,
  },
  submissions: {
    count: 3,
    lastSubmittedAt: "2026-10-25T11:05:00.000Z",
    lastTaskCode: "agent-review",
  },
  telegram: {
    membership: "member",
    restriction: "none",
    marketing: "stopped",
    observedAt: "2026-10-26T09:00:00.000Z",
    joinReminders: { sent: 3, lastAt: "2026-10-24T09:00:00.000Z" },
  },
  practiceWaitlist: {
    intakeName: "Поток весна 2027",
    active: true,
    joinedAt: "2026-10-10T07:30:00.000Z",
  },
};
