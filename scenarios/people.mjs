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
