// @ts-check
/** Synthetic roles; persistence adapters resolve their Accounts through the real identity interface. */
export const scenarioRoles = {
  owner: { subject: "fullstack-owner", name: "Владелец Тестов" },
  holder: {
    subject: "light-holder",
    name: "Покупатель Тестов",
    /** «Создание Platform Inside» of `seed-local-development.ts`. */
    productId: "72000000-0000-4000-8000-000000000007",
  },
  /** An ordinary member with a ready profile and no products. */
  learner: { subject: "light-learner", name: "Участник Тестов" },
  /** A new person: no name and no accepted terms, so the first sign-in is still to be driven. */
  newcomer: { subject: "light-newcomer", name: null },
};
