export const authoringScenario: Readonly<{
  products: Readonly<{
    architecture: Readonly<{ id: string; name: string; archived: false }>;
    database: Readonly<{ id: string; name: string; archived: false }>;
    legacy: Readonly<{ id: string; name: string; archived: true }>;
  }>;
  agentTopic: Readonly<{ id: string; name: string }>;
  reviewMaterial: Readonly<{
    id: string;
    title: string;
    publicationState: "unpublished";
  }>;
}>;
