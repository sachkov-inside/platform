// Same navigation entities appear in collections, sales, Materials and global search (#2335).
// Keep their identity/metadata here; each HTTP adapter owns its commands and state transitions.
export const authoringScenario = Object.freeze({
  products: Object.freeze({
    architecture: Object.freeze({
      id: "c0110000-0000-4000-8000-000000000001",
      name: "Архитектура приложения",
      archived: false,
    }),
    database: Object.freeze({
      id: "c0110000-0000-4000-8000-000000000002",
      name: "Работа с базой данных",
      archived: false,
    }),
    legacy: Object.freeze({
      id: "c0110000-0000-4000-8000-000000000003",
      name: "Прежнее руководство по развёртыванию",
      archived: true,
    }),
  }),
  agentTopic: Object.freeze({
    id: "97000000-0000-4000-8000-000000000101",
    name: "Разработка с агентами",
  }),
  reviewMaterial: Object.freeze({
    id: "97000000-0000-4000-8000-000000000001",
    title: "Ревью кода с агентом",
    publicationState: "unpublished",
  }),
});
