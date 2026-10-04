import type { AccessGround } from "./access-scenarios.js";

/**
 * Матрица проверок доступа (#902, #903): состояние Account × действие × поверхность × уровень
 * проверки. Таблица сценариев доступа рядом (`access-scenarios.ts`) говорит, что открывается и на
 * каком основании; эта матрица говорит, каким тестом и на каком уровне это доказано.
 *
 * Каждая клетка ссылается на существующий тест, на клетку таблицы сценариев, на новую проверку
 * задачи #904 (Web/BFF) или #906 (production) либо объясняет, почему уровень неприменим или
 * опирается на тест другого уровня той же строки. Тест policy- или module-уровня никогда не
 * обозначает production. Полноту и существование тестов держит `pnpm check`
 * (`test/unit/access-check-matrix.test.ts`).
 */

/** Состояния Account. Каждое сводится к основаниям таблицы сценариев доступа. */
export const accessCheckStates = [
  "anonymous",
  "account-without-entitlement",
  "learner-guide-a",
  "learner-guide-b",
  "expired",
  "revoked",
  "materials-only",
  "billing-only",
  "platform-administrator",
] as const;
export type AccessCheckState = (typeof accessCheckStates)[number];

/**
 * Основание из таблицы сценариев и разрешение, которыми задано состояние. «Ученик» — Account с
 * AccessGrant или назначением, чья область называет один Guide; это не роль IdP или RBAC.
 */
export const accessCheckStateGrounds: Readonly<
  Record<
    AccessCheckState,
    {
      readonly grounds: readonly AccessGround[];
      readonly permission:
        "materials:manage" | "billing:manage" | "platform:admin" | null;
    }
  >
> = {
  anonymous: { grounds: ["guest"], permission: null },
  "account-without-entitlement": {
    grounds: ["account-without-rights"],
    permission: null,
  },
  "learner-guide-a": {
    grounds: ["direct", "manual-assignment"],
    permission: null,
  },
  "learner-guide-b": {
    grounds: ["direct", "manual-assignment"],
    permission: null,
  },
  expired: { grounds: ["expired-or-revoked"], permission: null },
  revoked: { grounds: ["expired-or-revoked"], permission: null },
  "materials-only": {
    grounds: ["account-without-rights"],
    permission: "materials:manage",
  },
  "billing-only": {
    grounds: ["account-without-rights"],
    permission: "billing:manage",
  },
  "platform-administrator": {
    grounds: ["account-without-rights"],
    permission: "platform:admin",
  },
};

export const accessCheckActions = [
  "read-guide-a",
  "read-guide-b",
  "manage-materials",
  "manage-billing",
  "use-other-account-data",
] as const;
export type AccessCheckAction = (typeof accessCheckActions)[number];

/**
 * Поверхности: защищённые чтения Guide (`practice` — список заданий в HTTP и Web, все части
 * контекста задания в learner MCP), записи Materials и Billing, progress чтения и закладки Account.
 */
export const accessCheckSurfaces = [
  "body",
  "assets",
  "video",
  "practice",
  "materials-authoring",
  "billing-operations",
  "reading-progress",
  "bookmarks",
] as const;
export type AccessCheckSurface = (typeof accessCheckSurfaces)[number];

export const accessCheckLevels = [
  "facade-postgresql",
  "nest-http",
  "learner-mcp",
  "web-bff",
  "production",
] as const;
export type AccessCheckLevel = (typeof accessCheckLevels)[number];

/** Задачи #902, чьи проверки ещё не на `main`: fullstack (#904) и production-проход (#906). */
export const plannedCheckIssues = [904, 906] as const;

export type AccessCheckEvidence =
  /** Тест по пути от корня репозитория и его названию, как оно стоит в исходнике. */
  | { readonly kind: "test"; readonly file: string; readonly name: string }
  /** Клетка таблицы сценариев: её исполняет `test/integration/access-scenarios.test.ts`. */
  | { readonly kind: "scenario-cell"; readonly cell: string }
  | {
      readonly kind: "new-check";
      readonly issue: (typeof plannedCheckIssues)[number];
    }
  /** Отдельного теста этого уровня нет; клетку доказывает тест другого уровня той же строки. */
  | {
      readonly kind: "relies-on";
      readonly level: AccessCheckLevel;
      readonly because: string;
    }
  | { readonly kind: "not-applicable"; readonly because: string };

export interface AccessCheckRow {
  readonly state: AccessCheckState;
  readonly action: AccessCheckAction;
  readonly surface: AccessCheckSurface;
  readonly expected: "allowed" | "denied";
  readonly levels: Readonly<Record<AccessCheckLevel, AccessCheckEvidence>>;
}

/**
 * Форма, которую читает контроль полноты: он не доверяет типу и проверяет каждое имя, поэтому
 * негативная фикстура может назвать неизвестное состояние или пропустить уровень.
 */
export interface AccessCheckRowShape {
  readonly state: string;
  readonly action: string;
  readonly surface: string;
  readonly expected: "allowed" | "denied";
  readonly levels: Readonly<Partial<Record<string, AccessCheckEvidence>>>;
}

export function accessCheckRowId(row: {
  readonly state: string;
  readonly action: string;
  readonly surface: string;
}): string {
  return `${row.state}/${row.action}/${row.surface}`;
}

// --------------------------------------------------------------------------- доказательства

const test = (file: string, name: string): AccessCheckEvidence => ({
  kind: "test",
  file,
  name,
});
const cell = (id: string): AccessCheckEvidence => ({
  kind: "scenario-cell",
  cell: id,
});
const fullstack: AccessCheckEvidence = { kind: "new-check", issue: 904 };
const productionPass: AccessCheckEvidence = { kind: "new-check", issue: 906 };
const reliesOn = (
  level: AccessCheckLevel,
  because: string,
): AccessCheckEvidence => ({ kind: "relies-on", level, because });
const notApplicable = (because: string): AccessCheckEvidence => ({
  kind: "not-applicable",
  because,
});

const integration = (name: string) => `apps/backend/test/integration/${name}`;
const webFullstack = (name: string) => `apps/web/test/fullstack/${name}`;

const http = integration("scoped-access-http.test.ts");
const mcp = integration("scoped-learner-access-mcp.test.ts");
const guideAccess = integration("guide-access.test.ts");
const paymentMatrix = integration("payment-access-matrix.test.ts");
const learningPractice = integration("learning-practice.test.ts");
const billingOperations = integration("billing-operations.test.ts");
const billingHttp = integration("billing-pricing-http.test.ts");
const accountsApi = integration("accounts-api.test.ts");
const materialAuthoringWeb = webFullstack("material-authoring.spec.ts");

const httpTests = {
  anonymous:
    "anonymous reader gets no protected bytes of either Guide while the public Material stays open",
  withoutEntitlement:
    "Account without entitlement gets no protected bytes of either Guide while the public Material stays open",
  learnerA:
    "learner of Guide A reads its body, asset, video and practice list while Guide B stays closed",
  learnerB:
    "learner of Guide B reads its body, asset, video and practice list while Guide A stays closed",
  expired:
    "expired Guide A grant exposes no protected bytes while the public Material stays open",
  revoked:
    "revoking Guide A closes the next request and the earlier playback token while Guide B stays open",
  ownerSurfaces:
    "Materials-only and Billing-only Accounts get a typed denial on each other's write next to their own",
} as const;
const mcpTests = {
  anonymous:
    "material and practice calls without an Account token get 401 and no protected bytes",
  withoutEntitlement:
    "Account without entitlement reads the public Material and no protected Material or practice part",
  learnerA:
    "learner of Guide A reads its Material and every pinned practice part while Guide B stays closed",
  learnerB:
    "learner of Guide B reads its Material and every pinned practice part while Guide A stays closed",
  expired:
    "expired Guide A grant reads the public Material and no protected Material or practice part",
  revoked:
    "revoking Guide A closes the Material and every part pinned before revocation while Guide B stays open",
} as const;
const guideAccessTests = {
  material:
    "guide A allows its shared Material and direct resource only; B, draft and forged guide context stay denied",
  media:
    "direct file delivery and video tokens use real guide scope facts and recheck revoked access",
} as const;
const webTests = {
  lockedTeaser:
    "renders a locked teaser whose purchase starts inside the platform and fails closed on invalid proof",
  mediaConvergence:
    "media convergence: ${access} Material composes image, file and primary Video across Subjects",
  anonymousAsset:
    "member Material hides bytes from anonymous access and issues only a protected redirect",
  memberVideo:
    "member primary Video denies anonymous and non-member access while authorizing its owner",
  practiceDenied:
    "practice Reader keeps assignment metadata and protected body out of guest and denied views",
} as const;

const mcpMediaReference =
  "learner MCP не отдаёт bytes файла и видео: тело несёт только ссылку на asset и видео с признаком доступности";
const mcpReadOnly =
  "learner MCP только читает опубликованные материалы: в нём нет операций записи и чужих данных";
const noRevocationInProduction =
  "Отзыв доступа в production не выполняется (#902): переход проверяется только локально";
const noAdministratorInProduction =
  "Тестового Platform Administrator в production нет (#902): platform:admin проверяется только локально";
const productionWritesOnlyLocally =
  "Production-проход только читает (#902): записи проверяются локально; административные read surfaces Materials-only и Billing-only проверяет #906";
const productionReadsOnly =
  "Production-проход только читает (#902): записи и чужие данные Account проверяются локально";

const viaHttp = (because: string) => reliesOn("nest-http", because);
const facadeHasOneLearner =
  "Facade-тесты держат одного ученика Guide A; ученик Guide B проходит тот же facade на PostgreSQL в Nest HTTP";
const noFacadePracticeAccess =
  "Facade-теста задания для этого Account нет: `learning-practice.test.ts` отказывает только через подменённый authorize; Nest HTTP проходит настоящий ContentAccess на PostgreSQL";

// --------------------------------------------------------------------------- строки

type GuideSurface = "body" | "assets" | "video" | "practice";
type GuideRow = Readonly<Record<AccessCheckLevel, AccessCheckEvidence>>;

/** Четыре защищённые поверхности одного чтения Guide с общими доказательствами транспорта. */
function guideReads(
  state: AccessCheckState,
  action: "read-guide-a" | "read-guide-b",
  expected: "allowed" | "denied",
  levels: Readonly<Record<GuideSurface, GuideRow>>,
): AccessCheckRow[] {
  return (["body", "assets", "video", "practice"] as const).map((surface) => ({
    state,
    action,
    surface,
    expected,
    levels: levels[surface],
  }));
}

/** Learner MCP: материал и задание — тест транспорта, файл и видео не отдаются вовсе. */
function mcpLevel(surface: GuideSurface, name: string): AccessCheckEvidence {
  return surface === "assets" || surface === "video"
    ? notApplicable(mcpMediaReference)
    : test(mcp, name);
}

function transportLevels(
  surface: GuideSurface,
  httpName: string,
  mcpName: string,
): Pick<GuideRow, "nest-http" | "learner-mcp"> {
  return {
    "nest-http": test(http, httpName),
    "learner-mcp": mcpLevel(surface, mcpName),
  };
}

function learnerReads(
  state: "learner-guide-a" | "learner-guide-b",
  action: "read-guide-a" | "read-guide-b",
  expected: "allowed" | "denied",
): AccessCheckRow[] {
  const httpName =
    state === "learner-guide-a" ? httpTests.learnerA : httpTests.learnerB;
  const mcpName =
    state === "learner-guide-a" ? mcpTests.learnerA : mcpTests.learnerB;
  const facade = (surface: GuideSurface): AccessCheckEvidence => {
    if (state === "learner-guide-b") return viaHttp(facadeHasOneLearner);
    if (surface === "body") return test(guideAccess, guideAccessTests.material);
    if (surface === "practice") return viaHttp(noFacadePracticeAccess);
    return test(guideAccess, guideAccessTests.media);
  };
  const web: AccessCheckEvidence =
    state === "learner-guide-a"
      ? fullstack
      : viaHttp(
          "#904 проверяет в браузере ученика Guide A; ученик Guide B — зеркальный случай того же BFF, его различие A/B доказывает Nest HTTP",
        );
  const row = (surface: GuideSurface): GuideRow => ({
    "facade-postgresql": facade(surface),
    ...transportLevels(surface, httpName, mcpName),
    "web-bff": web,
    production: productionPass,
  });
  return guideReads(state, action, expected, {
    body: row("body"),
    assets: row("assets"),
    video: row("video"),
    practice: row("practice"),
  });
}

export const accessCheckMatrix: readonly AccessCheckRow[] = [
  ...guideReads("anonymous", "read-guide-a", "denied", {
    body: {
      "facade-postgresql": cell("product-material/guest"),
      ...transportLevels("body", httpTests.anonymous, mcpTests.anonymous),
      "web-bff": test(
        webFullstack("material-reader.spec.ts"),
        webTests.lockedTeaser,
      ),
      production: productionPass,
    },
    assets: {
      "facade-postgresql": viaHttp(
        "Facade-теста файла для гостя нет; Nest HTTP проходит тот же delivery и ContentAccess на PostgreSQL",
      ),
      ...transportLevels("assets", httpTests.anonymous, mcpTests.anonymous),
      "web-bff": test(materialAuthoringWeb, webTests.anonymousAsset),
      production: productionPass,
    },
    video: {
      "facade-postgresql": cell("video/guest"),
      ...transportLevels("video", httpTests.anonymous, mcpTests.anonymous),
      "web-bff": test(materialAuthoringWeb, webTests.memberVideo),
      production: productionPass,
    },
    practice: {
      "facade-postgresql": test(
        learningPractice,
        "denies anonymous and revoked readers without protected criteria or body",
      ),
      ...transportLevels("practice", httpTests.anonymous, mcpTests.anonymous),
      "web-bff": test(
        webFullstack("learning-practice.spec.ts"),
        webTests.practiceDenied,
      ),
      production: productionPass,
    },
  }),
  ...guideReads("account-without-entitlement", "read-guide-a", "denied", {
    body: {
      "facade-postgresql": cell("product-material/account-without-rights"),
      ...transportLevels(
        "body",
        httpTests.withoutEntitlement,
        mcpTests.withoutEntitlement,
      ),
      "web-bff": test(materialAuthoringWeb, webTests.mediaConvergence),
      production: productionPass,
    },
    assets: {
      "facade-postgresql": test(
        paymentMatrix,
        "путь покупки руководства открывает ровно его материалы, файлы, видео и артефакты",
      ),
      ...transportLevels(
        "assets",
        httpTests.withoutEntitlement,
        mcpTests.withoutEntitlement,
      ),
      "web-bff": test(materialAuthoringWeb, webTests.mediaConvergence),
      production: productionPass,
    },
    video: {
      "facade-postgresql": cell("video/account-without-rights"),
      ...transportLevels(
        "video",
        httpTests.withoutEntitlement,
        mcpTests.withoutEntitlement,
      ),
      "web-bff": test(materialAuthoringWeb, webTests.memberVideo),
      production: productionPass,
    },
    practice: {
      "facade-postgresql": viaHttp(noFacadePracticeAccess),
      ...transportLevels(
        "practice",
        httpTests.withoutEntitlement,
        mcpTests.withoutEntitlement,
      ),
      "web-bff": test(
        webFullstack("learning-practice.spec.ts"),
        webTests.practiceDenied,
      ),
      production: productionPass,
    },
  }),
  ...learnerReads("learner-guide-a", "read-guide-a", "allowed"),
  ...learnerReads("learner-guide-a", "read-guide-b", "denied"),
  ...learnerReads("learner-guide-b", "read-guide-b", "allowed"),
  ...learnerReads("learner-guide-b", "read-guide-a", "denied"),
  ...guideReads("expired", "read-guide-a", "denied", {
    body: {
      "facade-postgresql": cell("product-material/expired-or-revoked"),
      ...transportLevels("body", httpTests.expired, mcpTests.expired),
      "web-bff": test(materialAuthoringWeb, webTests.mediaConvergence),
      production: productionPass,
    },
    assets: {
      "facade-postgresql": viaHttp(
        "Facade-теста файла для истёкшего права нет; Nest HTTP проходит тот же delivery и ContentAccess на PostgreSQL",
      ),
      ...transportLevels("assets", httpTests.expired, mcpTests.expired),
      "web-bff": test(materialAuthoringWeb, webTests.mediaConvergence),
      production: productionPass,
    },
    video: {
      "facade-postgresql": cell("video/expired-or-revoked"),
      ...transportLevels("video", httpTests.expired, mcpTests.expired),
      "web-bff": test(materialAuthoringWeb, webTests.mediaConvergence),
      production: productionPass,
    },
    practice: {
      "facade-postgresql": viaHttp(noFacadePracticeAccess),
      ...transportLevels("practice", httpTests.expired, mcpTests.expired),
      "web-bff": viaHttp(
        "Fullstack-сценария задания для истёкшего права нет; отказ списка заданий доказывает Nest HTTP",
      ),
      production: productionPass,
    },
  }),
  ...guideReads("revoked", "read-guide-a", "denied", {
    body: {
      "facade-postgresql": cell("product-material/expired-or-revoked"),
      ...transportLevels("body", httpTests.revoked, mcpTests.revoked),
      "web-bff": fullstack,
      production: notApplicable(noRevocationInProduction),
    },
    assets: {
      "facade-postgresql": test(guideAccess, guideAccessTests.media),
      ...transportLevels("assets", httpTests.revoked, mcpTests.revoked),
      "web-bff": fullstack,
      production: notApplicable(noRevocationInProduction),
    },
    video: {
      "facade-postgresql": test(guideAccess, guideAccessTests.media),
      ...transportLevels("video", httpTests.revoked, mcpTests.revoked),
      "web-bff": fullstack,
      production: notApplicable(noRevocationInProduction),
    },
    practice: {
      "facade-postgresql": viaHttp(noFacadePracticeAccess),
      ...transportLevels("practice", httpTests.revoked, mcpTests.revoked),
      "web-bff": fullstack,
      production: notApplicable(noRevocationInProduction),
    },
  }),
  {
    state: "materials-only",
    action: "manage-materials",
    surface: "materials-authoring",
    expected: "allowed",
    levels: {
      "facade-postgresql": viaHttp(
        "Facade-тесты authoring подставляют authorPolicy; разрешение из базы проверяет Nest HTTP",
      ),
      "nest-http": test(http, httpTests.ownerSurfaces),
      "learner-mcp": notApplicable(mcpReadOnly),
      "web-bff": fullstack,
      production: notApplicable(productionWritesOnlyLocally),
    },
  },
  {
    state: "materials-only",
    action: "manage-billing",
    surface: "billing-operations",
    expected: "denied",
    levels: {
      "facade-postgresql": test(
        billingOperations,
        "сумма вне допустимого, неподтверждённый платёж и чужие полномочия отклоняются",
      ),
      "nest-http": test(http, httpTests.ownerSurfaces),
      "learner-mcp": notApplicable(mcpReadOnly),
      "web-bff": fullstack,
      production: notApplicable(productionWritesOnlyLocally),
    },
  },
  {
    state: "billing-only",
    action: "manage-billing",
    surface: "billing-operations",
    expected: "allowed",
    levels: {
      "facade-postgresql": test(
        billingOperations,
        "владелец читает платежи, условия и остаток к возврату без банковских секретов",
      ),
      "nest-http": test(
        billingHttp,
        "scoped billing permission opens the owner surface and maps its result codes",
      ),
      "learner-mcp": notApplicable(mcpReadOnly),
      "web-bff": fullstack,
      production: notApplicable(productionWritesOnlyLocally),
    },
  },
  {
    state: "billing-only",
    action: "manage-materials",
    surface: "materials-authoring",
    expected: "denied",
    levels: {
      "facade-postgresql": viaHttp(
        "Facade-тесты authoring подставляют authorPolicy; отказ по разрешению из базы проверяет Nest HTTP",
      ),
      "nest-http": test(http, httpTests.ownerSurfaces),
      "learner-mcp": notApplicable(mcpReadOnly),
      "web-bff": fullstack,
      production: notApplicable(productionWritesOnlyLocally),
    },
  },
  {
    state: "account-without-entitlement",
    action: "manage-materials",
    surface: "materials-authoring",
    expected: "denied",
    levels: {
      "facade-postgresql": viaHttp(
        "Facade-тесты authoring подставляют authorPolicy; отказ по разрешению из базы проверяет Nest HTTP",
      ),
      "nest-http": test(
        accountsApi,
        "protects and executes the complete Material authoring HTTP lifecycle",
      ),
      "learner-mcp": notApplicable(mcpReadOnly),
      "web-bff": fullstack,
      production: notApplicable(productionReadsOnly),
    },
  },
  {
    state: "account-without-entitlement",
    action: "manage-billing",
    surface: "billing-operations",
    expected: "denied",
    levels: {
      "facade-postgresql": viaHttp(
        "Facade-отказ Billing в `billing-operations.test.ts` получает покупатель с оплатой, а не Account без entitlement",
      ),
      "nest-http": test(
        billingHttp,
        "public catalog, trusted quote identity, owner authorization and wire conflicts",
      ),
      "learner-mcp": notApplicable(mcpReadOnly),
      "web-bff": fullstack,
      production: notApplicable(productionReadsOnly),
    },
  },
  {
    state: "platform-administrator",
    action: "manage-materials",
    surface: "materials-authoring",
    expected: "allowed",
    levels: {
      "facade-postgresql": reliesOn(
        "web-bff",
        "Facade-тесты authoring подставляют authorPolicy; platform:admin из базы проходит API и facade в fullstack-сценарии владельца",
      ),
      "nest-http": reliesOn(
        "web-bff",
        "HTTP-теста authoring с platform:admin нет; fullstack-сценарий владельца проходит настоящий Nest HTTP",
      ),
      "learner-mcp": notApplicable(mcpReadOnly),
      "web-bff": test(
        materialAuthoringWeb,
        "trusted author creates a PostgreSQL draft and opens its current Preview",
      ),
      production: notApplicable(noAdministratorInProduction),
    },
  },
  {
    state: "platform-administrator",
    action: "manage-billing",
    surface: "billing-operations",
    expected: "allowed",
    levels: {
      "facade-postgresql": test(
        billingOperations,
        "сумма вне допустимого, неподтверждённый платёж и чужие полномочия отклоняются",
      ),
      "nest-http": test(
        billingHttp,
        "public catalog, trusted quote identity, owner authorization and wire conflicts",
      ),
      "learner-mcp": notApplicable(mcpReadOnly),
      // Сценарий идёт в `pnpm smoke:enrollments` обязательного CI job `integration`, а не в nightly.
      "web-bff": test(
        webFullstack("enrollment.spec.ts"),
        "owner assigns scoped course and the open cabinet converges through real BFF and PostgreSQL",
      ),
      production: notApplicable(noAdministratorInProduction),
    },
  },
  {
    state: "account-without-entitlement",
    action: "use-other-account-data",
    surface: "reading-progress",
    expected: "denied",
    levels: {
      "facade-postgresql": test(
        integration("reading-activity.test.ts"),
        "batch reads are bounded, deduplicated, sparse and isolated by Account",
      ),
      "nest-http": test(
        integration("reading-activity-http.test.ts"),
        "trusted identity, personal no-store responses, conflict state, replay and bounded input",
      ),
      "learner-mcp": notApplicable(mcpReadOnly),
      "web-bff": fullstack,
      production: notApplicable(productionReadsOnly),
    },
  },
  {
    state: "account-without-entitlement",
    action: "use-other-account-data",
    surface: "bookmarks",
    expected: "denied",
    levels: {
      "facade-postgresql": test(
        integration("bookmarks.test.ts"),
        "add and remove are idempotent and isolated per Account",
      ),
      "nest-http": reliesOn(
        "facade-postgresql",
        "HTTP-теста закладок нет; изоляцию по Account доказывает facade на PostgreSQL",
      ),
      "learner-mcp": notApplicable(mcpReadOnly),
      "web-bff": fullstack,
      production: notApplicable(productionReadsOnly),
    },
  },
];
