"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  acknowledgeCourseAssistantDataNotice,
  beginCourseAssistantRepositoryConnection,
  disconnectCourseAssistantRepository,
  linkCourseAssistantRepository,
  readCourseAssistantRepositories,
} from "../api/course-assistant.browser";
import {
  courseAssistantErrorMessage,
  type CourseAssistantParticipant,
  type CourseAssistantWriteResult,
  type RepositoryConnectionOutcome,
} from "../model/course-assistant";
import {
  CourseAssistantPanelView,
  type CourseAssistantAction,
} from "./course-assistant-panel-view";

const courseAssistantRepositoriesQueryKey = [
  "course-assistant",
  "repositories",
] as const;

/**
 * Производственный путь экрана помощника: каждое действие — своя мутация через собственный BFF;
 * после записи страница перечитывает состояние на сервере.
 */
export function CourseAssistantPanel({
  participant,
  outcome,
}: {
  readonly participant: CourseAssistantParticipant;
  readonly outcome?: RepositoryConnectionOutcome | undefined;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  // После установки с несколькими репозиториями выбор нужен сразу, без лишнего нажатия.
  const [choosing, setChoosing] = useState(outcome === "choose_repository");
  const repositories = useQuery({
    queryKey: courseAssistantRepositoriesQueryKey,
    queryFn: readCourseAssistantRepositories,
    enabled: choosing,
    retry: false,
  });

  const settle = (result: CourseAssistantWriteResult) => {
    if (!result.ok) {
      setError(courseAssistantErrorMessage(result.code));
      return;
    }
    setError(undefined);
    setChoosing(false);
    queryClient.removeQueries({
      queryKey: courseAssistantRepositoriesQueryKey,
    });
    router.refresh();
  };
  const acknowledge = useMutation({
    mutationFn: () =>
      acknowledgeCourseAssistantDataNotice(participant.dataNotice.version),
    retry: false,
    onSuccess: settle,
  });
  const connect = useMutation({
    mutationFn: beginCourseAssistantRepositoryConnection,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(courseAssistantErrorMessage(result.code));
        return;
      }
      window.location.assign(result.installUrl);
    },
  });
  const link = useMutation({
    mutationFn: linkCourseAssistantRepository,
    retry: false,
    onSuccess: settle,
  });
  const disconnect = useMutation({
    mutationFn: disconnectCourseAssistantRepository,
    retry: false,
    onSuccess: settle,
  });

  const listed = choosing ? repositories.data : undefined;

  const pending: CourseAssistantAction | undefined = acknowledge.isPending
    ? "acknowledge"
    : connect.isPending || connect.data?.ok === true
      ? "connect"
      : choosing && repositories.isPending
        ? "repositories"
        : link.isPending
          ? "link"
          : disconnect.isPending
            ? "disconnect"
            : undefined;

  return (
    <CourseAssistantPanelView
      error={
        error ??
        (listed?.ok === false
          ? courseAssistantErrorMessage(listed.code)
          : undefined)
      }
      onAcknowledge={() => {
        acknowledge.mutate();
      }}
      onConnect={() => {
        connect.mutate();
      }}
      onDisconnect={() => {
        disconnect.mutate();
      }}
      onLink={(candidate) => {
        link.mutate({
          installationId: candidate.installationId,
          repositoryId: candidate.repository.id,
        });
      }}
      onShowRepositories={() => {
        // Повтор после ошибки: запрос уже включён, поэтому его перечитывают явно.
        if (choosing) void repositories.refetch();
        else setChoosing(true);
      }}
      outcome={outcome}
      participant={participant}
      pending={pending}
      repositories={listed?.ok === true ? listed.repositories : undefined}
    />
  );
}
