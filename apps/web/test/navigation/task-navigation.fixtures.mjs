// @ts-check
/** Isolated task corpus: the existing navigation products and their counts stay unchanged. */
export const taskNavigationSlug = "navigation-tasks";
export const protectedTaskMarker = "ЗАКРЫТОЕ-ТЕЛО-ЗАДАНИЯ";
const product = { slug: taskNavigationSlug, name: "Курс с заданиями" };
const tasks = [
  { code: "navigation-free-task", title: "Открытое задание", access: "free" },
  {
    code: "navigation-closed-task",
    title: "Закрытое задание",
    access: "closed",
  },
];
/** @type {Promise<void> | undefined} */
let gate;
/** @type {(() => void) | undefined} */
let release;

/** @param {boolean} hold */
export function holdNavigationTasks(hold) {
  release?.();
  gate = hold
    ? new Promise((resolve) => {
        release = resolve;
      })
    : undefined;
}

/** @param {string} path */
export async function waitNavigationTask(path) {
  if (path.startsWith(`/library/products/${taskNavigationSlug}/tasks/`))
    await gate;
}

/** @param {URL} url @param {boolean} authorized */
export function navigationTaskRoute(url, authorized) {
  if (url.pathname === `/library/products/${taskNavigationSlug}`) {
    return {
      status: 200,
      value: {
        kind: "series",
        hasNext: false,
        items: [],
        relatedSeries: [],
        topics: [],
        reference: {
          ...product,
          id: "11111111-1111-4111-8111-111111111116",
          cover: null,
          hasModeVariants: false,
          introduction: null,
          summary: "Проверка переходов к заданиям.",
        },
        chapters: [
          {
            id: "44444444-4444-4444-8444-444444444416",
            name: "Практика",
            summary: "",
            materialIds: [],
            tasks: tasks.map((task) => ({
              ...task,
              afterMaterialId: null,
              lastSubmittedAt: null,
              availability:
                task.access === "free" || authorized ? "available" : "locked",
            })),
          },
        ],
      },
    };
  }
  const prefix = `/library/products/${taskNavigationSlug}/tasks/`;
  if (!url.pathname.startsWith(prefix)) return undefined;
  const task = tasks.find(
    (candidate) => candidate.code === url.pathname.slice(prefix.length),
  );
  if (task === undefined)
    return { status: 404, value: { code: "product_task_not_found" } };
  const place = {
    code: task.code,
    title: task.title,
    product,
    chapter: { name: "Практика", ordinal: 1 },
  };
  if (task.access === "closed" && !authorized)
    return { status: 200, value: { access: "closed", task: place } };
  return {
    status: 200,
    value: {
      access: "open",
      task: {
        ...place,
        access: task.access,
        version: 1,
        definition: {
          situation:
            task.access === "closed"
              ? protectedTaskMarker
              : "Открытое условие задания",
          result: ["Проверенный результат"],
          freedom: "Выбери способ решения.",
          criteria: [],
        },
      },
      reviewProtocol: { version: "1", instructions: [] },
      relatedMaterials: [],
      submission: { accepting: false },
    },
  };
}
