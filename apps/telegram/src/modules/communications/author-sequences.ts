import { isTruthy } from "../../shared/truthiness.js";
import { hasText, presentText } from "../../shared/text.js";
import { unhandled } from "../../shared/unhandled.js";
import type {
  AuthorAction,
  AuthorButton,
  AuthorSequenceState,
  CommunicationSequenceAction,
  MessageDestination,
} from "./author-dialog.js";
import { messageLabel } from "./author-message-view.js";
import type { AuthorEvent, Turn } from "./author-turn.js";
import {
  CommunicationsError,
  type TemplateContent,
} from "./communications-contract.js";
import type {
  CommunicationSequenceSnapshot,
  SequenceStep,
  MessagePart,
} from "./sequence-types.js";

type Buttons = AuthorButton[];
const MAX_DELAY = 2147483647;
const back: Buttons = [["К последовательности", { kind: "seq:show" }]];
const root: Buttons = [
  ["Все последовательности", { kind: "seq:list" }],
  ["В меню", { kind: "home" }],
];
const names = {
  draft: "Черновик",
  published: "Опубликована",
  paused: "Приостановлена",
  archived: "В архиве",
};

/** Sequence buttons that start a composition; the sequence editor handles the rest. */
const SEQUENCE_ENTRIES = ["seq:new", "seq:posts"] as const;
export type SequenceEditorAction = Exclude<
  CommunicationSequenceAction,
  { kind: (typeof SEQUENCE_ENTRIES)[number] }
>;
export function isSequenceEditorAction(
  action: AuthorAction,
): action is SequenceEditorAction {
  return (
    action.kind.startsWith("seq:") &&
    !(SEQUENCE_ENTRIES as readonly string[]).includes(action.kind)
  );
}
/** Sequence buttons that do not leave the current prompt. */
const PROMPT_STEPS = [
  "seq:settings",
  "seq:messages",
  "seq:message",
  "seq:timing",
  "seq:timing-entry",
] as const;
/** Sequence buttons that leave the prompt and work without an open sequence. */
const SELECTIONS = [
  "seq:discard",
  "seq:list",
  "seq:read",
  "seq:show",
  "seq:intro",
  "seq:parts",
  "seq:parts-page",
  "seq:part",
  "seq:move-part",
  "seq:remove-part",
  "seq:sample",
  "seq:save-intro",
] as const;
type PromptStep = Extract<
  SequenceEditorAction,
  { kind: (typeof PROMPT_STEPS)[number] }
>;
/** Sequence buttons that need an open sequence; saving the intro may fall through to them. */
type SequenceEdit = Exclude<
  SequenceEditorAction,
  PromptStep | { kind: Exclude<(typeof SELECTIONS)[number], "seq:save-intro"> }
>;
function isKindOf<Action extends { kind: string }, Kind extends Action["kind"]>(
  kinds: readonly Kind[],
  action: Action,
): action is Extract<Action, { kind: Kind }> {
  return (kinds as readonly string[]).includes(action.kind);
}

// Sequence composition shares the admin's session, authorization, update receipt and reply outbox.

function sequenceState(t: Turn): AuthorSequenceState {
  return (t.state.sequenceAuthor ??= {});
}

function openSequence(s: AuthorSequenceState): CommunicationSequenceSnapshot {
  if (!s.sequence) throw new CommunicationsError("not_found");
  return s.sequence;
}

/** Starts a new sequence; the admin then asks for its first message. */
export function newSequence(t: Turn) {
  leavePrompts(t);
  t.retainSequenceDraft();
  t.state.sequenceAuthor = {
    sequence: {
      sequenceId: t.newId(),
      name: "Новая последовательность",
      isDefault: false,
      entryResponse: { stepId: t.newId(), parts: [] },
      steps: [],
      sources: [],
      revision: 0,
      publishedRevision: null,
      lifecycle: "draft",
    },
    dirty: true,
    prompt: "name",
  };
}

export function appendPrepared(t: Turn, content: TemplateContent) {
  const s = sequenceState(t);
  const f = openSequence(s);
  if (f.lifecycle === "archived")
    throw new CommunicationsError("revision_conflict");
  if (f.entryResponse.parts.length >= 100)
    throw new CommunicationsError("unsupported_content");
  s.sequence = {
    ...f,
    name:
      !isTruthy(f.entryResponse.parts.length) &&
      f.name === "Новая последовательность"
        ? (presentText(content.text.slice(0, 80)) ?? messageLabel(content))
        : f.name,
    entryResponse: {
      ...f.entryResponse,
      parts: [...f.entryResponse.parts, { partId: t.newId(), content }],
    },
  };
  s.target = "entry";
  s.dirty = true;
}

export function appendTimed(t: Turn, content: TemplateContent, offset: number) {
  const s = sequenceState(t);
  const f = openSequence(s);
  if (
    offset === 0 &&
    !isTruthy(f.steps.length) &&
    f.entryResponse.parts.length < 20
  )
    return appendPrepared(t, content);
  if (f.lifecycle === "archived" || !isTruthy(f.entryResponse.parts.length))
    throw new CommunicationsError("revision_conflict");
  s.sequence = {
    ...f,
    steps: [
      ...f.steps,
      {
        stepId: t.newId(),
        delaySeconds: offset,
        delayAnchor: "entry",
        parts: [{ partId: t.newId(), content }],
      },
    ],
  };
  s.dirty = true;
  s.target = "entry";
}

export function showSequence(t: Turn): void {
  const s = sequenceState(t),
    f = s.sequence;
  s.prompt = undefined;
  if (!f) return performSequence(t, { kind: "seq:list" });
  const pending = t.compositionButtons(f.sequenceId);
  t.reply(
    `${f.name}\n${names[f.lifecycle]}${isTruthy(s.dirty) ? " · есть правки" : ""}\nСообщений: ${f.entryResponse.parts.length + f.steps.reduce((n, step) => n + step.parts.length, 0)}. Основная последовательность: ${f.isDefault ? "да" : "нет"}.\n${f.steps
      .map((step, i) => `${i + 1}. Через ${stepTime(step)}`)
      .slice(0, 5)
      .join("\n")}`,
    [
      ...pending,
      ...(f.lifecycle !== "archived" && !isTruthy(pending.length)
        ? [
            [
              "Добавить сообщение",
              { kind: "sequence:sequence" },
            ] as AuthorButton,
          ]
        : []),
      ...(isTruthy(s.dirty)
        ? [["Сохранить черновик", { kind: "seq:save" }] as AuthorButton]
        : []),
      ...(!isTruthy(s.dirty) &&
      f.lifecycle !== "archived" &&
      isTruthy(f.revision) &&
      f.revision !== f.publishedRevision
        ? [
            [
              f.publishedRevision === null
                ? "Включить последовательность"
                : "Применить изменения",
              { kind: "seq:preview" },
            ] as AuthorButton,
          ]
        : []),
      ...(f.lifecycle !== "archived"
        ? [["Сообщения", { kind: "seq:messages" }] as AuthorButton]
        : []),
      ["Настройки", { kind: "seq:settings" }],
      ...(f.lifecycle === "draft" && !f.isDefault
        ? [["Сделать основной", { kind: "seq:default" }] as AuthorButton]
        : []),
      ...(f.lifecycle === "published"
        ? [
            [
              "Приостановить",
              { kind: "seq:life", value: "pause" },
            ] as AuthorButton,
          ]
        : []),
      ...(f.lifecycle === "paused"
        ? [
            [
              "Продолжить",
              { kind: "seq:life", value: "resume" },
            ] as AuthorButton,
          ]
        : []),
      ...(f.lifecycle !== "archived"
        ? [
            [
              "Отменить последовательность",
              {
                kind: isTruthy(f.revision)
                  ? "seq:confirm-archive"
                  : "seq:discard",
              },
            ] as AuthorButton,
          ]
        : []),
      ["Все последовательности", { kind: "seq:list" }],
    ],
  );
}

/**
 * The sequence's configuration. Saving, publication and the other lifecycle actions stay on its
 * card; an archived sequence is restored here.
 */
function settings(t: Turn) {
  const s = sequenceState(t),
    f = openSequence(s);
  t.reply(`Настройки · ${f.name}`, [
    ...t.compositionButtons(f.sequenceId),
    ...(f.lifecycle !== "archived"
      ? ([
          ["Название", { kind: "seq:name" }],
          ["Первый ответ", { kind: "seq:parts", id: "entry" }],
          ["Шаги и задержки", { kind: "seq:steps" }],
          ["Источники", { kind: "seq:sources" }],
          [
            f.isDefault ? "Убрать из основных" : "Сделать основной",
            { kind: "seq:default" },
          ],
        ] as Buttons)
      : [
          [
            "Восстановить",
            { kind: "seq:life", value: "restore" },
          ] as AuthorButton,
        ]),
    ["Общий вводный блок", { kind: "seq:intro" }],
    ...(isTruthy(s.dirty)
      ? [["Отказаться от правок", { kind: "seq:discard" }] as AuthorButton]
      : []),
    ...back,
  ]);
}

function parts(s: AuthorSequenceState): readonly MessagePart[] {
  if (s.target === "intro") return s.intro?.parts ?? [];
  if (s.target === "entry") return s.sequence?.entryResponse.parts ?? [];
  return (
    s.sequence?.steps.find((step) => step.stepId === s.target)?.parts ?? []
  );
}

function replaceParts(s: AuthorSequenceState, parts: readonly MessagePart[]) {
  if (s.target === "intro" && s.intro) s.intro = { ...s.intro, parts };
  else if (s.sequence && s.target === "entry")
    s.sequence = {
      ...s.sequence,
      entryResponse: { ...s.sequence.entryResponse, parts },
    };
  else if (s.sequence)
    s.sequence = {
      ...s.sequence,
      steps: s.sequence.steps.map((step) =>
        step.stepId === s.target ? { ...step, parts } : step,
      ),
    };
  s.dirty = true;
}

/** The messages of the selected sequence block. */
export function selectedParts(t: Turn) {
  return parts(sequenceState(t));
}

/** Applies an accepted message to its sequence block, or returns after a cancelled one. */
export function composeInSequence(
  t: Turn,
  destination: Extract<MessageDestination, { kind: "sequence" }>,
  content: TemplateContent | undefined,
) {
  const s = sequenceState(t);
  const id = s.target === "intro" ? s.intro?.introId : s.sequence?.sequenceId;
  if (id !== destination.id || s.target !== destination.target)
    throw new CommunicationsError("revision_conflict");
  const missingStep =
    s.target !== "intro" &&
    s.target !== "entry" &&
    !isTruthy(s.sequence?.steps.some((step) => step.stepId === s.target));
  if (content) {
    const revision =
      s.target === "intro" ? s.intro?.revision : s.sequence?.revision;
    if (
      missingStep ||
      revision !== destination.expectedRevision ||
      (s.sequence?.lifecycle === "archived" && s.target !== "intro")
    )
      throw new CommunicationsError("revision_conflict");
    const current = parts(s);
    if (
      hasText(destination.partId) &&
      !current.some((p) => p.partId === destination.partId)
    )
      throw new CommunicationsError("revision_conflict");
    if (
      !hasText(destination.partId) &&
      current.length >=
        (s.target === "intro" || s.target === "entry" ? 100 : 20)
    )
      throw new CommunicationsError("unsupported_content");
    replaceParts(
      s,
      hasText(destination.partId)
        ? current.map((p) =>
            p.partId === destination.partId ? { ...p, content } : p,
          )
        : [...current, { partId: t.newId(), content }],
    );
  }
  s.replacePartId = undefined;
  if (missingStep) return showSequence(t);
  partsMenu(t);
}

function partsMenu(t: Turn, offset = 0) {
  const s = sequenceState(t);
  const current = parts(s);
  const id = s.target === "intro" ? s.intro?.introId : s.sequence?.sequenceId;
  const title =
    s.target === "intro"
      ? "Общий вводный блок"
      : s.target === "entry"
        ? "Первый ответ"
        : "Сообщения шага";
  t.reply(
    `${title}\n${
      presentText(
        current
          .slice(offset, offset + 10)
          .map((p, i) => `${offset + i + 1}. ${messageLabel(p.content, 100)}`)
          .join("\n"),
      ) ?? "Добавьте сохранённый пост."
    }\nВыбранное содержимое сохраняется отдельно от исходного поста.${s.target === "intro" ? " После сохранения новые получатели увидят этот блок; прежним он повторно не придёт." : ""}`,
    [
      ...(hasText(id) ? t.compositionButtons(id) : []),
      ...current
        .slice(offset, offset + 10)
        .map((part, i): AuthorButton => [
          `Сообщение ${offset + i + 1}`,
          { kind: "seq:part", id: part.partId },
        ]),
      ...(offset > 0
        ? ([
            [
              "Предыдущие сообщения",
              { kind: "seq:parts-page", value: String(offset - 10) },
            ],
          ] as Buttons)
        : []),
      ...(current.length > offset + 10
        ? ([
            [
              "Следующие сообщения",
              { kind: "seq:parts-page", value: String(offset + 10) },
            ],
          ] as Buttons)
        : []),
      ["Создать сообщение", { kind: "compose:sequence" }],
      ["Добавить сохранённый пост", { kind: "seq:posts" }],
      ...(isTruthy(current.length)
        ? ([["Образцы себе", { kind: "seq:sample" }]] as Buttons)
        : []),
      ...(s.target === "intro"
        ? ([
            ["Сохранить общий блок", { kind: "seq:save-intro" }],
            // One way out keeps the save button on the first page of a short intro.
            ["Все последовательности", { kind: "seq:list" }],
          ] as Buttons)
        : back),
    ],
  );
}

export function performSequence(t: Turn, a: SequenceEditorAction): void {
  if (!isKindOf(PROMPT_STEPS, a)) return performSelection(t, a);
  switch (a.kind) {
    case "seq:settings":
      return settings(t);
    case "seq:messages":
      return messages(t, Number(a.value ?? 0));
    case "seq:message":
      sequenceState(t).target = a.value;
      return performSequence(t, { kind: "seq:part", id: a.id });
    case "seq:timing": {
      const s = sequenceState(t);
      s.timingPartId = a.id;
      s.prompt = "part-delay";
      return t.reply(
        timingAnchor(openSequence(s), a.id) === "entry"
          ? "Когда отправить это сообщение? Пришлите время от входа: например, 20 минут или 1 день."
          : "Когда отправить это сообщение? Пришлите задержку: например, 20 минут или 1 день. Она отсчитывается после предыдущего шага; для первого отложенного шага — после входа. Новое отложенное сообщение добавится в конец цепочки.",
        [["Сразу при входе", { kind: "seq:timing-entry", id: a.id }], ...back],
      );
    }
    case "seq:timing-entry":
      return moveTimedPart(t, a.id, null);
    default:
      return unhandled(a, "sequence prompt step");
  }
}

/** Clears the prompts that a navigation button leaves behind. */
function leavePrompts(t: Turn) {
  const s = sequenceState(t);
  t.state.prompt = undefined;
  s.prompt = undefined;
  return s;
}

function performSelection(
  t: Turn,
  a: Exclude<SequenceEditorAction, PromptStep>,
): void {
  const s = leavePrompts(t);
  if (!isKindOf(SELECTIONS, a)) return performEdit(t, s, a);
  switch (a.kind) {
    case "seq:discard": {
      const id =
        s.target === "intro" ? s.intro?.introId : s.sequence?.sequenceId;
      if (hasText(id)) {
        t.emit({ kind: "remove-draft", id });
        t.discardComposition(id);
      }
      t.state.sequenceAuthor = {};
      return performSequence(t, { kind: "seq:list" });
    }
    case "seq:list":
      t.retainSequenceDraft();
      return t.ask({ kind: "list-sequences", cursor: a.id });
    case "seq:read":
      t.retainSequenceDraft();
      return t.ask({ kind: "read-sequence", sequenceId: a.id });
    case "seq:show":
      return showSequence(t);
    case "seq:intro":
      t.retainSequenceDraft();
      // Intro edits have their own scratch snapshot; navigation explicitly leaves a sequence draft.
      return t.ask({ kind: "read-intro" });
    case "seq:parts":
      s.target = a.id;
      s.replacePartId = undefined;
      return partsMenu(t);
    case "seq:parts-page":
      return partsMenu(t, Number(a.value));
    case "seq:part": {
      const current = parts(s);
      const index = current.findIndex((p) => p.partId === a.id);
      const part = current[index];
      if (!part) throw new CommunicationsError("not_found");
      t.preview(part.content);
      return t.reply(
        `Сообщение ${index + 1} · ${part.content.type}\n${part.content.text.slice(0, 1000)}\nКнопок: ${part.content.buttons.length}`,
        [
          [
            "Изменить сообщение и кнопки",
            { kind: "compose:edit-sequence", id: part.partId },
          ],
          ...(s.target !== "intro"
            ? ([
                ["Когда отправить", { kind: "seq:timing", id: part.partId }],
              ] as Buttons)
            : []),
          [
            "Заменить из сохранённых",
            { kind: "seq:posts", value: part.partId },
          ],
          ...(index > 0
            ? ([
                [
                  "Выше",
                  { kind: "seq:move-part", id: part.partId, value: "-1" },
                ],
              ] as Buttons)
            : []),
          ...(index < current.length - 1
            ? ([
                [
                  "Ниже",
                  { kind: "seq:move-part", id: part.partId, value: "1" },
                ],
              ] as Buttons)
            : []),
          ["Убрать сообщение", { kind: "seq:remove-part", id: part.partId }],
          ["К сообщениям", { kind: "seq:parts-page", value: "0" }],
        ],
      );
    }
    case "seq:move-part":
    case "seq:remove-part": {
      const current = [...parts(s)];
      const index = current.findIndex((p) => p.partId === a.id);
      if (index < 0) throw new CommunicationsError("not_found");
      if (a.kind === "seq:remove-part") current.splice(index, 1);
      else {
        const next = index + Number(a.value);
        const [part, other] = [current[index], current[next]];
        if (part && other) [current[index], current[next]] = [other, part];
      }
      replaceParts(s, current);
      return partsMenu(t);
    }
    case "seq:sample":
      for (const part of parts(s))
        t.emit({ kind: "message", content: part.content });
      return t.reply(
        "Образцы выбранных сообщений поставлены в очередь только вам.",
        [["К сообщениям", { kind: "seq:parts-page", value: "0" }]],
      );
    case "seq:save-intro":
      if (!s.intro) return performEdit(t, s, a);
      if (!isTruthy(s.intro.parts.length))
        return t.reply("Добавьте хотя бы один сохранённый пост.", [
          ["К сообщениям", { kind: "seq:parts-page", value: "0" }],
        ]);
      return t.ask({
        kind: "validate-content",
        parts: s.intro.parts,
        purpose: "intro",
      });
    default:
      return unhandled(a, "sequence selection");
  }
}

function performEdit(t: Turn, s: AuthorSequenceState, a: SequenceEdit): void {
  const f = s.sequence;
  if (!f) return t.reply("Сначала откройте последовательность.", root);
  if (f.lifecycle === "archived" && a.kind !== "seq:life")
    return showSequence(t);
  switch (a.kind) {
    case "seq:name":
      s.prompt = "name";
      return t.reply(
        "Напишите название последовательности (до 128 символов).",
        back,
      );
    case "seq:default":
      s.sequence = { ...f, isDefault: !f.isDefault };
      s.dirty = true;
      return showSequence(t);
    case "seq:steps": {
      const offset = Number(a.value ?? 0);
      return t.reply(
        timedFromEntry(f.steps)
          ? "Шаги отправляются по времени от входа."
          : "Шаги отправляются по порядку.",
        [
          ...f.steps
            .slice(offset, offset + 15)
            .map((step, i): AuthorButton => [
              `Шаг ${offset + i + 1} · ${stepTime(step)}`,
              { kind: "seq:step", id: step.stepId },
            ]),
          ...(offset > 0
            ? ([
                [
                  "Предыдущие шаги",
                  { kind: "seq:steps", value: String(offset - 15) },
                ],
              ] as Buttons)
            : []),
          ...(f.steps.length > offset + 15
            ? ([
                [
                  "Следующие шаги",
                  { kind: "seq:steps", value: String(offset + 15) },
                ],
              ] as Buttons)
            : []),
          ["Добавить шаг", { kind: "seq:add-step" }],
          ...back,
        ],
      );
    }
    case "seq:add-step": {
      if (f.steps.length >= 100)
        return t.reply("В последовательности может быть до 100 шагов.", back);
      const fromEntry = timedFromEntry(f.steps);
      const step: SequenceStep = {
        stepId: t.newId(),
        delaySeconds: fromEntry
          ? Math.min((f.steps.at(-1)?.delaySeconds ?? 0) + 86400, MAX_DELAY)
          : 86400,
        ...(fromEntry && { delayAnchor: "entry" as const }),
        parts: [],
      };
      s.sequence = { ...f, steps: [...f.steps, step] };
      s.dirty = true;
      return performSequence(t, { kind: "seq:step", id: step.stepId });
    }
    case "seq:step": {
      const index = f.steps.findIndex((step) => step.stepId === a.id);
      const step = f.steps[index];
      if (!step) throw new CommunicationsError("not_found");
      s.target = step.stepId;
      return t.reply(
        `Шаг ${index + 1}\nЧерез ${stepTime(step)}\nСообщений: ${step.parts.length}`,
        [
          ["Сообщения шага", { kind: "seq:parts", id: step.stepId }],
          ["Задержка", { kind: "seq:delay" }],
          ...(index > 0
            ? ([
                [
                  "Поднять шаг",
                  { kind: "seq:move-step", id: step.stepId, value: "-1" },
                ],
              ] as Buttons)
            : []),
          ...(index < f.steps.length - 1
            ? ([
                [
                  "Опустить шаг",
                  { kind: "seq:move-step", id: step.stepId, value: "1" },
                ],
              ] as Buttons)
            : []),
          ["Убрать шаг", { kind: "seq:remove-step", id: step.stepId }],
          ["Все шаги", { kind: "seq:steps" }],
        ],
      );
    }
    case "seq:delay":
      s.prompt = "delay";
      return t.reply(
        f.steps.find((step) => step.stepId === s.target)?.delayAnchor ===
          "entry"
          ? "Напишите время от входа: 30 мин, 2 ч, 1 д или 0 для отправки сразу после первого ответа."
          : "Напишите задержку: 30 мин, 2 ч, 1 д или 0 для отправки сразу после предыдущего шага.",
        back,
      );
    case "seq:move-step":
    case "seq:remove-step": {
      const steps = [...f.steps];
      const index = steps.findIndex((step) => step.stepId === a.id);
      if (index < 0) throw new CommunicationsError("not_found");
      if (a.kind === "seq:remove-step") steps.splice(index, 1);
      else {
        const next = index + Number(a.value);
        const [step, other] = [steps[index], steps[next]];
        // Steps timed from entry keep their times in place, so moving a step moves its messages.
        if (step && other)
          [steps[index], steps[next]] = timedFromEntry(f.steps)
            ? [
                { ...other, delaySeconds: step.delaySeconds },
                { ...step, delaySeconds: other.delaySeconds },
              ]
            : [other, step];
      }
      s.sequence = { ...f, steps };
      s.dirty = true;
      return performSequence(t, { kind: "seq:steps" });
    }
    case "seq:sources": {
      const offset = Number(a.value ?? 0);
      return t.reply(
        "Источники входа. Код применяется после публикации. Ссылка бота должна содержать ?start=код.",
        [
          ...f.sources
            .slice(offset, offset + 15)
            .map((source): AuthorButton => [
              source.name.slice(0, 50),
              { kind: "seq:source", id: source.sourceId },
            ]),
          ...(offset > 0
            ? ([
                [
                  "Предыдущие источники",
                  { kind: "seq:sources", value: String(offset - 15) },
                ],
              ] as Buttons)
            : []),
          ...(f.sources.length > offset + 15
            ? ([
                [
                  "Следующие источники",
                  { kind: "seq:sources", value: String(offset + 15) },
                ],
              ] as Buttons)
            : []),
          ["Добавить источник", { kind: "seq:add-source" }],
          ...back,
        ],
      );
    }
    case "seq:source": {
      const source = f.sources.find((item) => item.sourceId === a.id);
      if (!source) throw new CommunicationsError("not_found");
      return t.reply(
        `${source.name}\nКод: ${source.code}\nПараметр ссылки: ?start=${source.code}`,
        [
          [
            "Убрать источник",
            { kind: "seq:remove-source", id: source.sourceId },
          ],
          ["Все источники", { kind: "seq:sources" }],
        ],
      );
    }
    case "seq:add-source":
      if (f.sources.length >= 100)
        return t.reply(
          "В последовательности может быть до 100 источников.",
          back,
        );
      s.prompt = "source-name";
      return t.reply(
        "Как назвать источник? Например: канал или описание видео.",
        back,
      );
    case "seq:remove-source":
      s.sequence = {
        ...f,
        sources: f.sources.filter((item) => item.sourceId !== a.id),
      };
      s.dirty = true;
      return performSequence(t, { kind: "seq:sources" });
    case "seq:save":
      return t.ask({
        kind: "save-sequence",
        sequence: f,
        then: { kind: "card" },
      });
    case "seq:preview":
    case "seq:publish":
      if (isTruthy(s.dirty) || !isTruthy(f.revision))
        return t.reply(
          "Сначала сохраните черновик. Проверка и публикация относятся к сохранённой версии.",
          back,
        );
      // Read locks definition changes through this transaction. Validation is answered for
      // exactly these parts outside the transaction, so it covers precisely the locked revision.
      return t.ask({
        kind: "lock-sequence",
        sequenceId: f.sequenceId,
        publish: a.kind === "seq:publish",
      });
    case "seq:confirm-archive":
      return t.reply(
        "Отменить последовательность? Новые сообщения больше не будут отправляться. Уже доставленные останутся у получателей.",
        [["Да, отменить", { kind: "seq:life", value: "archive" }], ...back],
      );
    case "seq:life":
      if (isTruthy(s.dirty) && a.value !== "archive") return showSequence(t);
      return t.ask({
        kind: "change-sequence",
        sequenceId: f.sequenceId,
        revision: f.revision,
        action: a.value,
      });
    case "seq:save-intro":
      return showSequence(t);
    default:
      return unhandled(a, "sequence action");
  }
}

function messages(t: Turn, offset: number) {
  const f = openSequence(sequenceState(t));
  const entries = [
    ...f.entryResponse.parts.map((p) => ({
      p,
      target: "entry",
      when: "При входе",
    })),
    ...f.steps.flatMap((step) =>
      step.parts.map((p) => ({
        p,
        target: step.stepId,
        when: `Через ${formatSequenceDelay(step.delaySeconds)}`,
      })),
    ),
  ];
  t.reply(
    `${f.name} · сообщения\n${
      timedFromEntry(f.steps)
        ? "Время отсчитывается от входа."
        : f.steps.some((step) => step.delayAnchor === "entry")
          ? "Время каждого шага указано в настройках, в разделе «Шаги и задержки»."
          : "Задержка шага отсчитывается после предыдущего шага."
    } Выберите сообщение для настройки.`,
    [
      ...entries
        .slice(offset, offset + 5)
        .map(({ p, target, when }, i): AuthorButton => [
          `${offset + i + 1}. ${when} · ${messageLabel(p.content, 25)}`,
          { kind: "seq:message", id: p.partId, value: target },
        ]),
      ...(offset > 0
        ? [
            [
              "Предыдущие",
              { kind: "seq:messages", value: String(offset - 5) },
            ] as AuthorButton,
          ]
        : []),
      ...(entries.length > offset + 5
        ? [
            [
              "Следующие",
              { kind: "seq:messages", value: String(offset + 5) },
            ] as AuthorButton,
          ]
        : []),
      ["Добавить сообщения", { kind: "batch:sequence" }],
      ...back,
    ],
  );
}

/**
 * Moves one message to the entry response (`delaySeconds` null) or to its own delayed step.
 * A message already published in another step keeps its place: moving it would rewrite
 * delivery history. `published` is the answer about that history, once the move needs it.
 */
function moveTimedPart(
  t: Turn,
  partId: string,
  delaySeconds: number | null,
  published?: boolean,
) {
  const s = sequenceState(t),
    f = openSequence(s);
  if (f.lifecycle === "archived")
    throw new CommunicationsError("revision_conflict");
  const source = f.steps.find((step) =>
    step.parts.some((p) => p.partId === partId),
  );
  const part =
    source?.parts.find((p) => p.partId === partId) ??
    f.entryResponse.parts.find((p) => p.partId === partId);
  if (!part) throw new CommunicationsError("revision_conflict");
  if (!(delaySeconds === null && !source)) {
    if (!(delaySeconds !== null && source?.parts.length === 1)) {
      if (published === undefined)
        return t.ask({
          kind: "read-part-history",
          sequenceId: f.sequenceId,
          partId,
          delaySeconds,
        });
      if (published)
        return t.reply(
          delaySeconds === null
            ? "Это сообщение уже публиковалось в другом шаге. Его перенос изменил бы историю отправок. Добавьте новое сообщение в нужный шаг; задержку существующего шага можно менять."
            : "Это сообщение уже публиковалось в другом шаге. Добавьте новое сообщение в нужный шаг; задержку существующего шага можно менять.",
          back,
        );
    }
    if (delaySeconds !== null && !source && f.entryResponse.parts.length === 1)
      throw new CommunicationsError("malformed");
    if (delaySeconds !== null && source?.parts.length === 1)
      s.sequence = {
        ...f,
        steps: inTimeOrder(
          f.steps.map((step) =>
            step.stepId === source.stepId ? { ...step, delaySeconds } : step,
          ),
        ),
      };
    else {
      const entry = f.entryResponse.parts.filter((p) => p.partId !== partId);
      const steps = f.steps
        .map((step) => ({
          ...step,
          parts: step.parts.filter((p) => p.partId !== partId),
        }))
        .filter((step) => step.parts.length > 0);
      s.sequence = {
        ...f,
        entryResponse: {
          ...f.entryResponse,
          parts: delaySeconds === null ? [...entry, part] : entry,
        },
        steps:
          delaySeconds === null
            ? steps
            : inTimeOrder([
                ...steps,
                {
                  stepId: t.newId(),
                  delaySeconds,
                  ...(timedFromEntry(f.steps) && {
                    delayAnchor: "entry" as const,
                  }),
                  parts: [part],
                },
              ]),
      };
    }
    s.dirty = true;
  }
  s.prompt = undefined;
  s.timingPartId = undefined;
  performSequence(t, { kind: "seq:messages" });
}

export function answerSequence(t: Turn, input: { text: string }) {
  const s = sequenceState(t);
  const f = s.sequence;
  const text = input.text.trim();
  if (!f) return t.reply("Откройте последовательность заново.", root);
  switch (s.prompt) {
    case "part-delay": {
      const delay = parseSequenceDelay(text);
      if (delay === undefined)
        return t.reply(
          "Введите задержку: например, 20 минут или 1 день.",
          back,
        );
      if (s.target === "entry" && f.entryResponse.parts.length === 1)
        return t.reply(
          "Оставьте хотя бы одно сообщение при входе. Остальные можно перенести в отложенные шаги.",
          back,
        );
      return moveTimedPart(t, s.timingPartId ?? "", delay);
    }
    case "name":
    case "source-name":
      if (!hasText(text) || text.length > 128)
        return t.reply("Нужно от 1 до 128 символов.", back);
      if (s.prompt === "source-name") {
        s.sourceName = text;
        s.prompt = "source-code";
        return t.reply(
          "Напишите уникальный код: m_ и от 1 до 40 латинских букв, цифр, _ или -. Например m_youtube.",
          back,
        );
      }
      s.sequence = { ...f, name: text };
      s.dirty = true;
      return showSequence(t);
    case "source-code":
      if (
        !/^m_[A-Za-z0-9_-]{1,40}$/.test(text) ||
        f.sources.some((source) => source.code === text)
      )
        return t.reply(
          "Код должен начинаться с m_ и быть уникальным. После префикса — от 1 до 40 латинских букв, цифр, _ или -.",
          back,
        );
      if (s.sourceName === undefined)
        throw new CommunicationsError("malformed");
      s.sequence = {
        ...f,
        sources: [
          ...f.sources,
          { sourceId: t.newId(), name: s.sourceName, code: text },
        ],
      };
      s.dirty = true;
      return performSequence(t, { kind: "seq:sources" });
    case "delay": {
      const delaySeconds = parseSequenceDelay(text);
      if (delaySeconds === undefined)
        return t.reply(
          "Не удалось понять задержку. Примеры: 30 мин, 2 ч, 1 д, 0.",
          back,
        );
      s.sequence = {
        ...f,
        steps: inTimeOrder(
          f.steps.map((step) =>
            step.stepId === s.target ? { ...step, delaySeconds } : step,
          ),
        ),
      };
      s.dirty = true;
      if (!hasText(s.target)) throw new CommunicationsError("not_found");
      return performSequence(t, { kind: "seq:step", id: s.target });
    }
    case undefined:
      return showSequence(t);
    default:
      return unhandled(s.prompt, "sequence prompt");
  }
}

/** Continues a sequence step after the executing layer answered its query. */
export function answerSequenceQuery(
  t: Turn,
  event: Extract<
    AuthorEvent,
    {
      kind:
        | "sequences-listed"
        | "sequence-read"
        | "intro-read"
        | "content-validated"
        | "intro-saved"
        | "sequence-locked"
        | "sequence-published"
        | "publication-previewed"
        | "sequence-changed"
        | "part-history-read";
    }
  >,
): void {
  switch (event.kind) {
    case "sequences-listed":
      t.state.sequenceAuthor = {};
      return t.reply(
        "Последовательности · черновики сохраняются при каждом действии",
        [
          ["Создать последовательность", { kind: "seq:new" }],
          ...event.items.map(({ id, name, status }): AuthorButton => [
            `${name.slice(0, 40)} · ${status === "edited" ? "есть правки" : names[status]}`,
            { kind: "seq:read", id },
          ]),
          ...(hasText(event.nextCursor)
            ? [
                [
                  "Следующие последовательности",
                  { kind: "seq:list", id: event.nextCursor },
                ] as AuthorButton,
              ]
            : []),
          ["В меню", { kind: "home" }],
        ],
      );
    case "sequence-read":
      t.state.sequenceAuthor = event.sequenceAuthor;
      return showSequence(t);
    case "intro-read":
      t.state.sequenceAuthor = event.sequenceAuthor;
      return partsMenu(t);
    case "content-validated": {
      const s = sequenceState(t);
      const result = event.result;
      if (event.purpose === "intro") {
        if (result.status !== "ok" || isTruthy(result.targetErrors.length))
          return t.reply(
            "Общий блок не сохранён: проверка материалов недоступна или ссылки ведут на недоступные материалы.",
            [["К сообщениям", { kind: "seq:parts-page", value: "0" }]],
          );
        if (!s.intro) throw new CommunicationsError("not_found");
        return t.ask({ kind: "save-intro", intro: s.intro });
      }
      if (result.status !== "ok")
        return t.reply(
          result.status === "denied"
            ? "Право автора не подтверждено. Публикация недоступна."
            : "Не удалось проверить материалы в Platform. Попробуйте проверку позже; публикации не было.",
          back,
        );
      if (isTruthy(result.targetErrors.length))
        return t.reply(
          `Публикация недоступна. Исправьте ссылки в выбранных постах:\n${result.targetErrors
            .slice(0, 10)
            .map(
              (error) =>
                `${error.url.slice(0, 200)} — ${{ not_found: "не найдено", not_published: "не опубликовано", not_free: "нет бесплатного доступа", incomplete: "серия не готова" }[error.reason]}`,
            )
            .join("\n")}`,
          back,
        );
      const f = openSequence(s);
      return t.ask({
        kind: "publish-sequence",
        sequenceId: f.sequenceId,
        revision: f.revision,
        publish: event.purpose === "publish",
      });
    }
    case "intro-saved": {
      const s = sequenceState(t);
      if (event.intro) s.intro = event.intro;
      s.dirty = false;
      return t.reply(
        "Общий вводный блок сохранён для будущих получателей. Уже получившим его повторной отправки не будет.",
        root,
      );
    }
    case "sequence-locked": {
      const f = openSequence(sequenceState(t));
      if (event.revision !== f.revision)
        throw new CommunicationsError("revision_conflict");
      return t.ask({
        kind: "validate-content",
        parts: [
          ...f.entryResponse.parts,
          ...f.steps.flatMap((step) => step.parts),
        ],
        purpose: event.publish ? "publish" : "preview",
      });
    }
    case "sequence-published":
      sequenceState(t).sequence = event.sequence;
      return showSequence(t);
    case "publication-previewed": {
      const p = event.preview;
      return t.reply(
        `Публикация версии ${p.revision}\nНовых шагов: ${p.addedStepIds.length}\nИзменённых: ${p.editedStepIds.length}\nУдалённых: ${p.deletedStepIds.length}\nПорядок изменён: ${p.reorderedStepIds.length}\nПолучателей продолжения: ${p.eligibleContacts}\nИз них уже завершили прежнюю последовательность: ${p.completedParticipantsReceivingNewSteps}\nУже доставленное повторно не отправляется.`,
        [["Опубликовать последовательность", { kind: "seq:publish" }], ...back],
      );
    }
    case "sequence-changed": {
      const s = sequenceState(t);
      const f = openSequence(s);
      if (event.sequence) {
        s.sequence = event.sequence;
        s.dirty = false;
        t.emit({ kind: "remove-draft", id: f.sequenceId });
      }
      return showSequence(t);
    }
    case "part-history-read":
      return moveTimedPart(
        t,
        event.partId,
        event.delaySeconds,
        event.published,
      );
    default:
      return unhandled(event, "sequence answer");
  }
}

/** Applies a saved sequence; the caller decides what the author sees next. */
export function applySequenceSave(
  t: Turn,
  sequence: CommunicationSequenceSnapshot | undefined,
) {
  const s = sequenceState(t);
  if (sequence) s.sequence = sequence;
  s.dirty = false;
}

/** The author asked to save a draft that the contract does not accept yet. */
export function rejectSequenceSave(t: Turn) {
  t.reply(
    "Добавьте хотя бы один пост в первый ответ и в каждый шаг, затем сохраните черновик.",
    back,
  );
}

export function parseSequenceDelay(value: string): number | undefined {
  const match =
    /^(\d+)\s*(с|сек(?:унда|унды|унд)?|мин(?:ута|уты|ут)?|м|ч|час(?:а|ов)?|д|дн(?:я|ей)?|день)?$/iu.exec(
      value.trim().toLowerCase(),
    );
  if (!match) return undefined;
  const factors: Record<string, number> = {
    с: 1,
    сек: 1,
    мин: 60,
    м: 60,
    ч: 3600,
    час: 3600,
    д: 86400,
    дн: 86400,
  };
  const seconds =
    Number(match[1]) *
    (factors[match[2]?.toLowerCase() ?? "с"] ??
      (isTruthy(match[2]?.startsWith("мин"))
        ? 60
        : isTruthy(match[2]?.startsWith("час"))
          ? 3600
          : isTruthy(match[2]?.startsWith("д"))
            ? 86400
            : 1));
  return Number.isSafeInteger(seconds) && seconds <= MAX_DELAY
    ? seconds
    : undefined;
}
/** When a delayed step is sent, as the author reads it. */
function stepTime(step: SequenceStep) {
  return `${formatSequenceDelay(step.delaySeconds)} ${step.delayAnchor === "entry" ? "от входа" : "после предыдущего шага"}`;
}

/**
 * Whether every step counts from entry, as the bot has authored sequences since #43. New steps of
 * such a sequence count from entry too, and its step order follows time.
 */
function timedFromEntry(steps: readonly SequenceStep[]) {
  return steps.every((step) => step.delayAnchor === "entry");
}

/** The anchor of a message's new time: a step with only this message keeps its own anchor. */
function timingAnchor(f: CommunicationSequenceSnapshot, partId: string) {
  const own = f.steps.find(
    (step) => step.parts.length === 1 && step.parts[0]?.partId === partId,
  );
  return own ? own.delayAnchor : timedFromEntry(f.steps) ? "entry" : undefined;
}

/** Sorts steps timed from entry by time; a chain of steps keeps the author's order. */
function inTimeOrder(steps: readonly SequenceStep[]): SequenceStep[] {
  return timedFromEntry(steps)
    ? [...steps].sort((a, b) => a.delaySeconds - b.delaySeconds)
    : [...steps];
}

export function formatSequenceDelay(seconds: number): string {
  for (const [unit, factor] of [
    ["д", 86400],
    ["ч", 3600],
    ["мин", 60],
  ] as const)
    if (seconds > 0 && seconds % factor === 0)
      return `${seconds / factor} ${unit}`;
  return `${seconds} с`;
}
