// @ts-check
import { legacyAssetsScenario } from "./legacy-assets.mjs";

/** Existing development catalogue identities and their illustrated preview variants. */
export const legacyCatalogueScenario = {
  product: {
    name: "Создание Platform Inside",
    slug: "platform-inside",
    summary: "Путь от продуктовой идеи до работающей Platform.",
  },
  offer: {
    name: "Руководство «Создание Platform Inside»",
    withSupportName: "Руководство «Создание Platform Inside» с сопровождением",
    twoYearName: "Руководство «Создание Platform Inside» на два года",
  },
  overview: {
    slug: legacyAssetsScenario.slug,
    title: "Как устроен Inside Platform",
  },
  closedGuide: {
    slug: "developer-pipeline-bez-poteri-konteksta",
    title: "Developer Pipeline без потери контекста",
  },
  illustrated: {
    materialSummary:
      "Практический разбор: от понятных границ к работающему приложению.",
    primaryTopic: { name: "Архитектура", slug: "platform" },
  },
  videos: {
    pipeline: {
      providerVideoId: "local-home-developer-pipeline",
      durationSeconds: 628,
      slug: "video-pro-developer-pipeline",
      titleVariants: {
        development: "Видео про Developer Pipeline",
        illustrated: "От задачи до релиза: Developer Pipeline",
      },
    },
    deepModules: {
      providerVideoId: "local-home-deep-modules",
      durationSeconds: 481,
      title: "Глубокие модули на практике",
      slugVariants: {
        development: "video-pro-glubokie-moduli",
        illustrated: "glubokie-moduli-na-praktike",
      },
    },
    productContext: {
      providerVideoId: "local-home-product-context",
      durationSeconds: 754,
      title: "Продукт и инженерный контекст",
      slugVariants: {
        development: "video-pro-produkty-i-kontekst",
        illustrated: "produkt-i-inzhenernyy-kontekst",
      },
    },
  },
};
