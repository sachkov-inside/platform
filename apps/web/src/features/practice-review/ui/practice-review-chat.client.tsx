"use client";

/**
 * Temporary semantic UI for #788.
 * Replace through #800 after Storybook acceptance.
 */

import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatTransport } from "ai";
import { createContext, useContext, useMemo } from "react";

import { z } from "zod";

import {
  candidateCommandSchema,
  practiceReviewPartSchema,
  practiceStatusLabels,
  reviewRefusalPartSchema,
  type PracticeReviewAction,
  type PracticeReviewUIMessage,
  type PracticeStatus,
} from "../model/practice-review";
import {
  ReviewChoice,
  ReviewProgress,
  ReviewRefusal,
  ReviewResult,
} from "./practice-review-blocks";

export interface PracticeReviewChatProps {
  readonly practiceId: string;
  readonly title: string;
  /** Версия задания, которую участник видит сейчас; `null` — задание недоступно. */
  readonly contextVersion: string | null;
  readonly criteria: readonly {
    readonly id: string;
    readonly requirement: string;
  }[];
  readonly status: PracticeStatus;
  readonly initialMessages: PracticeReviewUIMessage[];
  /** Идёт проверка: чат переподключается к её потоку. */
  readonly resume: boolean;
  /** Storybook подставляет сценарный транспорт; production ходит в BFF практики. */
  readonly transport?: ChatTransport<PracticeReviewUIMessage> | undefined;
}

interface ChatActions {
  readonly busy: boolean;
  readonly requirements: ReadonlyMap<string, string>;
  readonly choose: (
    reviewId: string,
    candidate: { readonly id: string; readonly label: string },
  ) => void;
  readonly review: (contextVersion: string, chooseWork?: boolean) => void;
}

const ChatActionsContext = createContext<ChatActions | null>(null);

function useChatActions(): ChatActions {
  const actions = useContext(ChatActionsContext);
  if (actions === null) throw new Error("Practice review chat is missing");
  return actions;
}

const reviewChatApi = "/api/account/course-assistant/practice-review-chat";
const candidateChatApi = "/api/account/course-assistant/review-candidate-chat";

function chatTransport(
  practiceId: string,
): ChatTransport<PracticeReviewUIMessage> {
  return new DefaultChatTransport<PracticeReviewUIMessage>({
    api: reviewChatApi,
    // Истории беседы серверу не нужно: она хранится на сервере. Уходит только команда, и у
    // каждой команды свой адрес.
    prepareSendMessagesRequest: ({ body }) => {
      const action: unknown = body?.["action"];
      const command = candidateCommandSchema.safeParse(action);
      return command.success
        ? { api: candidateChatApi, body: command.data }
        : { api: reviewChatApi, body: { practiceId, ...reviewBody(action) } };
    },
    prepareReconnectToStreamRequest: () => ({
      api: `${reviewChatApi}?${new URLSearchParams({ practiceId }).toString()}`,
    }),
  });
}

function reviewBody(action: unknown) {
  const parsed = z
    .object({
      expectedContextVersion: z.string(),
      chooseWork: z.boolean().optional(),
    })
    .safeParse(action);
  return parsed.success ? parsed.data : {};
}

/** Assistant Conversation практики (#788): проверка одной кнопкой и её итог в чате. */
export function PracticeReviewChat(props: PracticeReviewChatProps) {
  const transport = useMemo(
    () => props.transport ?? chatTransport(props.practiceId),
    [props.transport, props.practiceId],
  );
  const chat = useChat<PracticeReviewUIMessage>({
    id: `practice:${props.practiceId}`,
    messages: props.initialMessages,
    resume: props.resume,
    transport,
  });
  const runtime = useAISDKRuntime(chat, { joinStrategy: "none" });
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const send = (text: string, action: PracticeReviewAction) => {
    void chat.sendMessage({ text }, { body: { action } });
  };
  const hasReviews = chat.messages.some(
    (message) => message.role === "assistant",
  );
  const actions: ChatActions = {
    busy,
    requirements: new Map(
      props.criteria.map(({ id, requirement }) => [id, requirement]),
    ),
    choose(reviewId, candidate) {
      send(`Проверить: ${candidate.label}`, {
        kind: "choose",
        reviewId,
        candidateId: candidate.id,
      });
    },
    review(contextVersion, chooseWork = false) {
      send(
        chooseWork
          ? "Проверить другую работу"
          : hasReviews
            ? "Проверить снова"
            : "Проверить задание",
        {
          kind: "review",
          practiceId: props.practiceId,
          expectedContextVersion: contextVersion,
          chooseWork,
        },
      );
    },
  };
  const contextVersion = props.contextVersion;
  return (
    <ChatActionsContext value={actions}>
      <AssistantRuntimeProvider runtime={runtime}>
        <section
          aria-label="Беседа с помощником"
          className="flex flex-col gap-4"
        >
          <header>
            <h1 className="text-2xl font-semibold">{props.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Статус задания:{" "}
              <span className="font-medium text-foreground">
                {practiceStatusLabels[props.status]}
              </span>
            </p>
          </header>
          <ThreadPrimitive.Root className="flex flex-col gap-4">
            <ThreadPrimitive.Viewport className="flex flex-col gap-4">
              <ThreadPrimitive.Messages>
                {({ message }) =>
                  message.role === "user" ? (
                    <UserMessage />
                  ) : (
                    <AssistantMessage />
                  )
                }
              </ThreadPrimitive.Messages>
            </ThreadPrimitive.Viewport>
          </ThreadPrimitive.Root>
          {chat.error === undefined ? null : (
            <p
              className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm"
              role="alert"
            >
              Связь с помощником прервалась. Обновите страницу: идущая проверка
              продолжится.
            </p>
          )}
          {contextVersion === null ? (
            <p className="text-sm text-muted-foreground">
              Задание сейчас недоступно вашему аккаунту; история проверок
              сохранена.
            </p>
          ) : (
            <div>
              <button
                className="min-h-11 rounded-lg bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-60"
                disabled={busy}
                onClick={() => {
                  actions.review(contextVersion);
                }}
                type="button"
              >
                {hasReviews ? "Проверить снова" : "Проверить задание"}
              </button>
              {hasReviews ? (
                <button
                  className="ml-3 min-h-11 rounded-lg border px-5 font-medium disabled:opacity-60"
                  disabled={busy}
                  onClick={() => {
                    actions.review(contextVersion, true);
                  }}
                  type="button"
                >
                  Проверить другую работу
                </button>
              ) : null}
            </div>
          )}
        </section>
      </AssistantRuntimeProvider>
    </ChatActionsContext>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="self-end rounded-xl bg-muted px-4 py-2 text-sm">
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex flex-col gap-2">
      <MessagePrimitive.Parts>
        {({ part }) => {
          if (part.type !== "data") return null;
          if (part.name === "practice-review")
            return <PracticeReviewPart data={part.data} />;
          if (part.name === "practice-review-refusal")
            return <RefusalPart data={part.data} />;
          return null;
        }}
      </MessagePrimitive.Parts>
    </MessagePrimitive.Root>
  );
}

function PracticeReviewPart({ data }: { readonly data: unknown }) {
  const actions = useChatActions();
  const isLast = useAuiState(({ message }) => message.isLast);
  const part = practiceReviewPartSchema.safeParse(data);
  if (!part.success) return null;
  const { stage, review } = part.data;
  if (stage === "progress") return <ReviewProgress review={review} />;
  if (stage === "choice")
    return (
      <ReviewChoice
        // Выбирать можно только в последнем вопросе, пока чат не занят.
        disabled={actions.busy || !isLast}
        onChoose={(candidate) => {
          actions.choose(review.id, candidate);
        }}
        review={review}
      />
    );
  return (
    <ReviewResult
      onRecheckNewVersion={actions.review}
      requirements={actions.requirements}
      review={review}
    />
  );
}

function RefusalPart({ data }: { readonly data: unknown }) {
  const actions = useChatActions();
  const refusal = reviewRefusalPartSchema.safeParse(data);
  if (!refusal.success) return null;
  return (
    <ReviewRefusal
      onRecheckNewVersion={actions.review}
      refusal={refusal.data}
    />
  );
}
